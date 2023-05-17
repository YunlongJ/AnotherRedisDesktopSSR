import Redis from 'ioredis';
import { createTunnel } from 'tunnel-ssh';
import vue from '@/main.js';
import { remote } from '@electron/remote';
import { writeCMD } from '@/commands.js';
import net from 'net';
import { SocksClient } from 'socks';

const fs = require('fs');

const { sendCommand } = Redis.prototype;

// redis command log
Redis.prototype.sendCommand = function (...options) {
  const command = options[0];

  // readonly mode
  if (this.options.connectionReadOnly && writeCMD[command.name.toUpperCase()]) {
    command.reject(new Error('You are in readonly mode! Unable to execute write command!'));
    return command.promise;
  }

  // exec directly, without logs
  if (this.withoutLogging === true) {
    // invalid in next calling
    this.withoutLogging = false;
    return sendCommand.apply(this, options);
  }

  const start = performance.now();
  const response = sendCommand.apply(this, options);
  const cost = performance.now() - start;

  const record = {
    time: new Date(), connectionName: this.options.connectionName, command, cost,
  };
  vue.$bus.$emit('commandLog', record);

  return response;
};

// fix ioredis hgetall key has been toString()
Redis.Command.setReplyTransformer('hgetall', (result) => {
  const arr = [];
  for (let i = 0; i < result.length; i += 2) {
    arr.push([result[i], result[i + 1]]);
  }

  return arr;
});


function autoClose(server, connection) {
  connection.on('close', () => {
    server.getConnections((error, count) => {
      if (count === 0) {
        server.close();
      }
    });
  });
}

async function createClient(config) {
  const options = {
    proxy: {
      host: config.host, // ipv4 or ipv6 or hostname
      port: config.port - 0,
      type: config.type, // Proxy version (4 or 5)
    },
    command: 'connect', // SOCKS command (createConnection factory function only supports the connect command)

    destination: {
      host: config.dstHost, // github.com (hostname lookups are supported with SOCKS v4a and 5)
      port: config.dstPort - 0,
    },
    timeout: 60000,
  };
  try {
    return await SocksClient.createConnection(options);
  } catch (err) {
    // Handle errors
    if (err) {
      console.log(err);
    }
    return null;
  }
}
async function createServer(options) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((serversocket) => {
      createClient(options.socksOptions).then((socksClient) => {
        serversocket.on('data', (data) => {
          socksClient.socket.write(data);
        });
        socksClient.socket.on('data', (rec) => {
          serversocket.write(rec);
        });
        socksClient.socket.on('end', () => {
          serversocket.end();
        });
      });
    });
    const errorHandler = function (error) {
      reject(error);
    };
    server.on('error', errorHandler);
    process.on('uncaughtException', errorHandler);
    server.listen(options);
    server.on('listening', () => {
      process.removeListener('uncaughtException', errorHandler);
      resolve(server);
    });
  });
}


async function createSockTunnel(socksOptions) {
  return new Promise((async (resolve, reject) => {
    let server;
    try {
      server = await createServer({
        host: '127.0.0.1',
        port: 0,
        socksOptions,
      });
    } catch (e) {
      return reject(e);
    }
    resolve([server]);
  }));
}

export default {
  createConnection(host, port, auth, config, promise = true, forceStandalone = false, removeDb = false) {
    const options = this.getRedisOptions(host, port, auth, config);
    let client = null;

    if (removeDb) {
      delete options.db;
    }

    if (forceStandalone) {
      client = new Redis(options);
    }

    // sentinel redis
    else if (config.sentinelOptions) {
      const sentinelOptions = this.getSentinelOptions(host, port, auth, config);
      client = new Redis(sentinelOptions);
    }

    // cluster redis
    else if (config.cluster) {
      const clusterOptions = this.getClusterOptions(options, config.natMap ? config.natMap : {});
      client = new Redis.Cluster([{ port, host }], clusterOptions);
    }
    // standalone redis
    else {
      client = new Redis(options);
    }

    if (promise) {
      return new Promise((resolve, reject) => {
        resolve(client);
      });
    }

    return client;
  },

  createSockConnection(socksOptions, auth, config) {
    const configRaw = JSON.parse(JSON.stringify(config));
    const socksOptionsRaw = JSON.parse(JSON.stringify(socksOptions));
    socksOptionsRaw.dstHost = config.host;
    socksOptionsRaw.dstPort = config.port;
    return new Promise((resolve, reject) => {
      createSockTunnel(socksOptionsRaw).then(([server, connection]) => {
        const listenAddress = server.address();
        if (configRaw.cluster) {
          const client = this.createConnection(listenAddress.address, listenAddress.port, auth, configRaw, false, true);
          client.on('ready', () => {
            // get all cluster nodes info
            client.call('cluster', 'nodes').then((reply) => {
              const nodes = this.getClusterNodes(reply);
              // create ssh tunnel for each node
              this.createClusterSockTunnels(socksOptions, nodes).then((tunnels) => {
                configRaw.natMap = this.initNatMap(tunnels);
                // select first line of tunnels to connect
                console.log(tunnels);
                const clusterClient = this.createConnection(tunnels[0].localHost, tunnels[0].localPort, auth, configRaw, false);
                resolve(clusterClient);
              });
            }).catch((e) => {
              console.log(e);
              reject(e);
            });
          });

          client.on('error', (e) => {
            console.log('error cluster');
            reject(e);
          });
        }
      });
    });
  },

  createSSHConnection(sshOptions, host, port, auth, config) {
    const sshOptionsDict = this.getSSHOptions(sshOptions, host, port);

    const configRaw = JSON.parse(JSON.stringify(config));
    const sshConfigRaw = JSON.parse(JSON.stringify(sshOptionsDict));

    const sshPromise = new Promise((resolve, reject) => {
      createTunnel(...Object.values(sshOptionsDict)).then(([server, connection]) => {
        const listenAddress = server.address();

        // sentinel mode
        if (configRaw.sentinelOptions) {
          // this is a sentinel connection, remove db
          const client = this.createConnection(listenAddress.address, listenAddress.port, auth, configRaw, false, true, true);

          client.on('ready', () => {
            client.call('sentinel', 'get-master-addr-by-name', configRaw.sentinelOptions.masterName).then((reply) => {
              if (!reply) {
                return reject(new Error(`Master name "${configRaw.sentinelOptions.masterName}" not exists!`));
              }

              // connect to the master node via ssh
              this.createClusterSSHTunnels(sshConfigRaw, [{ host: reply[0], port: reply[1] }]).then((tunnels) => {
                const sentinelClient = this.createConnection(
                  tunnels[0].localHost, tunnels[0].localPort, configRaw.sentinelOptions.nodePassword, configRaw, false, true,
                );

                return resolve(sentinelClient);
              });
            }).catch((e) => {
              reject(e);
            }); // sentinel exec failed
          });

          client.on('error', (e) => {
            reject(e);
          });
        }

        // ssh cluster mode
        else if (configRaw.cluster) {
          const client = this.createConnection(listenAddress.address, listenAddress.port, auth, configRaw, false, true);

          client.on('ready', () => {
            // get all cluster nodes info
            client.call('cluster', 'nodes').then((reply) => {
              const nodes = this.getClusterNodes(reply);

              // create ssh tunnel for each node
              this.createClusterSSHTunnels(sshConfigRaw, nodes).then((tunnels) => {
                configRaw.natMap = this.initNatMap(tunnels);
                // select first line of tunnels to connect
                const clusterClient = this.createConnection(tunnels[0].localHost, tunnels[0].localPort, auth, configRaw, false);
                resolve(clusterClient);
              });
            }).catch((e) => {
              reject(e);
            });
          });

          client.on('error', (e) => {
            reject(e);
          });
        }

        // ssh standalone redis
        else {
          const client = this.createConnection(listenAddress.address, listenAddress.port, auth, configRaw, false);
          return resolve(client);
        }

        // create SSH tunnel failed
      }).catch((e) => {
        // vue.$message.error('SSH errror: ' + e.message);
        // vue.$bus.$emit('closeConnection');
        reject(e);
      });
    });

    return sshPromise;
  },

  getSSHOptions(options, host, port) {
    const tunnelOptions = {
      autoClose: false,
    };
    // where your localTCP Server is listening
    const serverOptions = {
      host: '127.0.0.1',
      port: 0,
    };
    // ssh server
    const sshOptions = {
      host: options.host,
      port: options.port,
      username: options.username,
      password: options.password,
      privateKey: this.getFileContent(options.privatekey, options.privatekeybookmark),
      passphrase: options.passphrase ? options.passphrase : undefined,
      readyTimeout: (options.timeout) > 0 ? (options.timeout * 1000) : 30000,
      keepaliveInterval: 10000,
    };
    // forward link in ssh server
    const forwardOptions = {
      srcAddr: '127.0.0.1',
      srcPort: 0,
      dstAddr: host,
      dstPort: port,
    };

    // Tips: small dict is ordered, should replace to Map if dict is large
    return {
      tunnelOptions, serverOptions, sshOptions, forwardOptions,
    };
  },

  getRedisOptions(host, port, auth, config) {
    return {
      // add additional host+port to options for "::1"
      host,
      port,
      family: 0,

      connectTimeout: 30000,
      retryStrategy: times => this.retryStragety(times, { host, port }),
      enableReadyCheck: false,
      connectionName: config.connectionName ? config.connectionName : null,
      password: auth,
      db: config.db ? config.db : undefined,
      // ACL support
      username: config.username ? config.username : undefined,
      tls: config.sslOptions ? this.getTLSOptions(config.sslOptions) : undefined,
      connectionReadOnly: config.connectionReadOnly ? true : undefined,
      // return int as string to avoid big number issues
      stringNumbers: true,
      enableOfflineQueue: true,
    };
  },

  getSentinelOptions(host, port, auth, config) {
    return {
      sentinels: [{ host, port }],
      sentinelPassword: auth,
      password: config.sentinelOptions.nodePassword,
      name: config.sentinelOptions.masterName,
      connectTimeout: 30000,
      retryStrategy: times => this.retryStragety(times, { host, port }),
      enableReadyCheck: false,
      connectionName: config.connectionName ? config.connectionName : null,
      db: config.db ? config.db : undefined,
      // ACL support
      username: config.username ? config.username : undefined,
      tls: config.sslOptions ? this.getTLSOptions(config.sslOptions) : undefined,
    };
  },

  getClusterOptions(redisOptions, natMap = {}) {
    return {
      connectionName: redisOptions.connectionName,
      enableReadyCheck: false,
      slotsRefreshTimeout: 30000,
      redisOptions,
      natMap,
    };
  },

  getClusterNodes(nodes, type = 'master') {
    const result = [];
    nodes = nodes.split('\n');

    for (let node of nodes) {
      if (!node) {
        continue;
      }

      node = node.trim().split(' ');

      if (node[2].includes(type)) {
        const dsn = node[1].split('@')[0];
        const lastIndex = dsn.lastIndexOf(':');

        const host = dsn.substr(0, lastIndex);
        const port = dsn.substr(lastIndex + 1);

        result.push({ host, port });
      }
    }

    return result;
  },

  createClusterSockTunnels(socksOptions, nodes) {
    const sshTunnelStack = [];

    for (const node of nodes) {
      // tunnelssh will change 'config' param, so just copy it
      const socksOptionsCopy = JSON.parse(JSON.stringify(socksOptions));
      socksOptionsCopy.dstHost = node.host;
      socksOptionsCopy.dstPort = node.port;
      const promise = new Promise((resolve, reject) => {
        const sshPromise = createSockTunnel(socksOptionsCopy);
        sshPromise.then(([server, connection]) => {
          const addr = server.address();
          const line = {
            localHost: addr.address,
            localPort: addr.port,
            dstHost: node.host,
            dstPort: node.port,
          };
          resolve(line);
        }).catch((e) => {
          reject(e);
        });
      });
      sshTunnelStack.push(promise);
    }
    return Promise.all(sshTunnelStack);
  },

  createClusterSSHTunnels(sshConfig, nodes) {
    const sshTunnelStack = [];

    for (const node of nodes) {
      // tunnelssh will change 'config' param, so just copy it
      const sshConfigCopy = JSON.parse(JSON.stringify(sshConfig));

      // revocery the buffer after json.parse
      if (sshConfigCopy.sshOptions.privateKey) {
        sshConfigCopy.sshOptions.privateKey = Buffer.from(sshConfigCopy.sshOptions.privateKey);
      }

      sshConfigCopy.forwardOptions.dstHost = node.host;
      sshConfigCopy.forwardOptions.dstPort = node.port;

      const promise = new Promise((resolve, reject) => {
        const sshPromise = createTunnel(...Object.values(sshConfigCopy));
        sshPromise.then(([server, connection]) => {
          const addr = server.address();
          const line = {
            localHost: addr.address,
            localPort: addr.port,
            dstHost: node.host,
            dstPort: node.port,
          };

          resolve(line);
        }).catch((e) => {
          reject(e);
        });
      });

      sshTunnelStack.push(promise);
    }

    return Promise.all(sshTunnelStack);
  },

  initNatMap(tunnels) {
    const natMap = {};

    for (const line of tunnels) {
      natMap[`${line.dstHost}:${line.dstPort}`] = { host: line.localHost, port: line.localPort };
    }

    return natMap;
  },

  getTLSOptions(options) {
    return {
      // ca: options.ca ? fs.readFileSync(options.ca) : '',
      // key: options.key ? fs.readFileSync(options.key) : '',
      // cert: options.cert ? fs.readFileSync(options.cert) : '',
      ca: this.getFileContent(options.ca, options.cabookmark),
      key: this.getFileContent(options.key, options.keybookmark),
      cert: this.getFileContent(options.cert, options.certbookmark),

      checkServerIdentity: (servername, cert) =>
        // skip certificate hostname validation
        undefined,
      rejectUnauthorized: false,
    };
  },

  retryStragety(times, connection) {
    const maxRetryTimes = 3;

    if (times >= maxRetryTimes) {
      vue.$message.error('Too Many Attempts To Reconnect. Please Check The Server Status!');
      vue.$bus.$emit('closeConnection');
      return false;
    }

    // reconnect after
    return Math.min(times * 200, 1000);
  },

  getFileContent(file, bookmark = '') {
    if (!file) {
      return undefined;
    }

    try {
      // mac app store version, read through bookmark
      if (bookmark) {
        const bookmarkClose = remote.app.startAccessingSecurityScopedResource(bookmark);
      }

      const content = fs.readFileSync(file);
      (typeof bookmarkClose === 'function') && bookmarkClose();

      return content;
    } catch (e) {
      // force alert
      alert(`${vue.$t('message.key_no_permission')}\n[${e.message}]`);
      vue.$bus.$emit('closeConnection');

      return undefined;
    }
  },
};
