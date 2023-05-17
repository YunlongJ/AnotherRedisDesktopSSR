<img align="right" width="120" src="https://cdn.jsdelivr.net/gh/qishibo/img/ano-square-icon-128.png">

# Another Redis Desktop Manager （fork from https://github.com/qishibo/AnotherRedisDesktopManager）

<hr/>

> 原作者还没怎么支持sockv5, 有空再给他提个pr

## Feature Log
- 2023-05-16: support sockv5 and update electron version
- 2022-10-07: Arrow Keys support in key list && Memory Analysis in folder
- 2022-08-05: Clone Connection && Tabs Contextmenu\Mousewheel Support
- 2022-04-01: Protobuf Support && Memory Analysis
- 2022-03-03: Readonly Mode && Mointor Support
- 2022-01-24: Command Dump Support
- 2022-01-05: Support To Load All Keys
- 2022-01-01: Brotli\Gzip\Deflate Support && RedisJSON Support
- 2021-11-26: JSON Editable && Subscribe Support
- 2021-08-30: Execution log Support && Add Hot Keys
- 2021-08-16: Custom Formatter View Support!
- 2021-06-30: Sentinel Support!!
- 2021-06-24: ACL Support
- 2021-05-03: Stream Support && Cli Command Tips Support
- 2021-02-28: Connection Color Tag && Search History Support
- 2021-02-03: Multiple Select\Delete && Msgpack Viewer Support
- 2020-12-30: Tree View Support!!!
- 2020-11-03: Binary View Support && SSH Passparse\Timeout Support
- 2020-09-04: SSH Cluster Support && Extension Commands Support
- 2020-06-18: SSL/TLS Support!!!
- 2020-04-28: Page Zoom && Big Key Loads With Scan && Auto Json
- 2020-04-18: Unvisible Key\Value Format Support
- 2020-04-04: Cluster Support!!!
- 2020-03-13: Dark Mode Support!!! && JsonView In Other Place
- 2020-02-16: SSH Private Key Support
- 2020-02-13: Open Cli Console In Tabs
- 2019-06-14: Custom Font-Family Support
- 2019-05-28: Key List Resizable
- 2019-05-09: Search Support In Hash List Set Zset
- 2019-04-26: Auto Updater
- 2019-04-09: SSH Tunnel Connection Support
- 2019-04-01: Extract Search Support
- 2019-02-22: Single Connection Support
- 2019-01-08: Project Start


## Dev Build

### Linux Or Mac

```bash
# clone code
git clone https://github.com/qishibo/AnotherRedisDesktopManager.git --depth=1
cd AnotherRedisDesktopManager

# install dependencies
npm install

# if download electron failed during installing, use this command
# ELECTRON_MIRROR="https://npm.taobao.org/mirrors/electron/" npm install

# serve with hot reload at localhost:9988
npm start


# after the previous step is completed to 100%, open another tab, build up a desktop client
npm run electron
```

If linux errors like this:

```bash
# if error like this
../src/FontManagerLinux.cc:1:35: fatal error: fontconfig/fontconfig.h: No such file or directory

# then try this
sudo apt install libfontconfig1-dev
```


### Windows

``` bash
# install build tools for the first time, just execute once
npm install -g windows-build-tools

# clone code
git clone https://github.com/qishibo/AnotherRedisDesktopManager.git --depth=1
cd AnotherRedisDesktopManager

# install dependencies, 32-bit or 64-bit all use win32
npm install --platform=win32

# if download electron failed during installing, use this command
# npm config set ELECTRON_MIRROR http://npm.taobao.org/mirrors/electron/
# npm install --platform=win32

# serve with hot reload at localhost:9988
npm start


# after the previous step is completed to 100%, open another tab, build up a desktop client
npm run electron
```

### Build Package

```bash
# prepare before package
npm run pack:prepare

# build package on respective platforms
# on windows build 64bit package
npm run pack:win
# on windows build 32bit package
npm run pack:win32

# on mac
npm run pack:mac

# on linux
npm run pack:linux
```
## License

[MIT](LICENSE)



