# WebDAV 同步与 APK 自动构建

## 使用 WebDAV

解锁保险库后进入 **Backup → WebDAV sync**，填写：

- **WebDAV root URL**：服务商提供的已有 WebDAV 根地址，例如
  `https://dav.example/remote.php/dav/files/alice/`。
- **Sync directory**：该根地址下的目录，例如 `Backups/Kryptos`，默认 `Kryptos`。
  不存在时逐级创建，支持中文和空格。它不是本地目录。
- **WebDAV username / password**：WebDAV 账号和密码，支持服务商的应用专用令牌。
- 上方 **Backup password**：独立的备份加密密码；所有设备使用相同密码。

点击 **Sync with WebDAV**，通过现有系统身份验证后同步。连接设置随本地
保险库加密保存，锁定时清空界面中的凭据。

上方备份密码框下面提供 **Remember backup encryption password** 开关，勾选后点击
**Save backup password preference**，即可单独保存，不要求先填写 WebDAV 地址。
下次进入 Backup 页面自动填入。取消勾选后再次保存会删除已记住的备份密码。
它只保存在本机加密保险库内，不上传到 WebDAV。同步时也会保存此选项。

WebDAV 登录密码有独立的 **Remember WebDAV login password** 开关，点击
**Save WebDAV settings** 保存地址、目录、用户名及密码选项。
**Clear saved connection and passwords** 会清除连接设置和两类已记住的密码，
保留账号条目。此操作也需要系统身份验证。

WebDAV 目前为手动同步，点击 **Sync with WebDAV** 才会联网；记住密码不会开启后台同步。
WebDAV 密码和备份密码可以不同。建议使用 HTTPS；HTTP 会明文传输 WebDAV
认证凭据。Android 支持自建 HTTP 服务，HTTPS 证书始终校验，不跟随重定向。

与 KryptosCore 共用 `<目录>/kryptos-sync.txt`：沿用现有加密 Base64 导入导出
格式、PBKDF2-HMAC-SHA256 100000 轮、随机 16 字节 nonce 和认证标签。仅上传
账号元数据；前缀、生成的密码、本机密钥、WebDAV 凭据均不上传。

同步先下载解密并合并，再加密上传，成功后保存到本机。它沿用现有合并机制：
新增条目会合并，完全相同的账号去重；同一站点/账号的 UUID、名称拼写、长度或
字符集不同时进入 **Resolve sync conflicts**，逐条显示本地与云端的站点、用户名、
长度、字符集；种子不同时会提示，即使参数相同也会生成不同密码。

每条选择 **Keep local（保留本地）** 或 **Use cloud（使用云端）**，可以回到上一条
修改选择。没有默认选项；全部选好后点击 **Apply choices and sync**，再上传合并结果
并保存到本机。选择本地会将该条本地版本写入云端；选择云端会替换本机该条的完整
生成参数，包括 UUID。其他不冲突的账号仍自动合并。请选择能生成你当前在用密码的
那份数据。点击 **Cancel sync** 或锁定应用，会取消整次同步，不应用任何选择。

**删除不会传播**，
其他设备或远端仍有的条目可能再次出现。当前为手动同步，不在后台自动执行。

远端文件必须返回强 ETag，并支持条件 PUT。已有文件通过 `If-Match` 更新，
首次创建用 `If-None-Match: *`。选择冲突期间云端被其他设备修改，也会返回 412，
请重新同步并根据新数据重新选择；旧选择不会自动套用。不强行覆盖云端。
密码错误、数据损坏、权限不足、取消或未完成冲突选择不会更新本地条目。上传成功后若本地存储失败，
修复存储后重试即可。锁定会取消正在进行的同步；每次请求限制 30 秒、整个操作
限制 120 秒（等待你选择冲突时暂停计时），备份上限 2 MB。

Web 预览还要求服务端允许 CORS：`GET, PUT, MKCOL, PROPFIND` 方法和
`Authorization, Content-Type, Depth, If-Match, If-None-Match` 请求头，并暴露
`ETag` 响应头。Android 不受浏览器 CORS 限制。原生模块修改后需要重新构建 APK。

Core 示例：

```sh
kryptos sync https://dav.example/remote.php/dav/files/alice Backups/Kryptos alice
```

## GitHub Actions APK

仓库 **Actions → Android APK** 支持手动运行，每次分支推送也自动运行。
PR 执行测试与类型检查，推送和手动运行在通过检查后构建 APK。在该次运行的
**Artifacts** 下载 `KryptosMobile-<preview/release>-<run number>`，解压得到 APK
与 SHA256 校验文件。无需 Metro 或本地 Android 环境。

未配置 secrets 时自动生成临时签名，产出 **preview APK**，可直接安装测试。
不同运行的临时签名不同，不能覆盖安装旧预览包；卸载会丢失本地保险库，请先导出
加密备份。需要稳定覆盖升级时，配置下列四个仓库 Actions secrets：

| Secret | 值 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 原有 release keystore 文件的完整 Base64，无换行 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 密钥别名 |
| `ANDROID_KEY_PASSWORD` | 私钥密码 |

四个必须同时设置。可复用现有本地 release 签名文件，保证后续版本可覆盖安装。
设置后产出 **release APK**；`versionCode` 使用 workflow run number。
密钥只用于签名，不上传到 artifact，构建结束清除临时签名文件。

CI 使用仓库 Gradle wrapper、JDK 17、Node 22.14.0 和 package.json 中固定的 pnpm，
不调用依赖 E 盘路径的本地 PowerShell 构建脚本。Gradle wrapper 改用官方分发地址。
