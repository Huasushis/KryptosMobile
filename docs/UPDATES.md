# 应用升级

设置页提供当前版本、手动检查更新、下载并安装、手动打开 Release 页面，以及
“解锁后检查更新”开关。自动检查默认关闭；开启后每次启动应用，在首次解锁后
检查一次 GitHub 的最新正式 Release。检查和下载不发送账号、前缀或保险库数据。
发现新版只提示，不会自动安装。

Android 下载完成后会校验 SHA-256、包名、versionCode 和签名。只允许与当前
安装使用相同签名的更新。随后调用 Android 系统安装器，需要用户确认。
如系统尚未允许 Kryptos 安装应用，先打开对应授权页；允许后返回，再点安装。
安装过程中不删除本地保险库和 SecureStore。Web/iOS 提供手动打开 Release
页面的入口，内置 APK 安装仅支持 Android。

## 正式发布与固定签名

此前 CI 的临时签名预览版每次生成新密钥，它们彼此不能覆盖升级，也不能直接
升级到使用不同密钥的正式版。原来的临时私钥没有保存，无法事后恢复相同签名。
先通过加密备份保留数据，再安排迁移到固定签名版本；不要为了安装新版直接卸载
唯一保存账号数据的应用。

未来版本要能持续覆盖升级，需要保管同一份正式 keystore，并配置仓库 Secrets：

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

上传已有签名密钥时，应使用当前正式安装所对应的密钥；不要每次生成新密钥。
仓库不存储私钥。签名配置见 [APK 文档](WEBDAV.md)。

推送正式版本标签（例如 `v1.1.0`）会运行测试、编译固定签名 APK，并发布 GitHub
Release，包含 `KryptosMobile-release.apk`、`SHA256SUMS.txt` 和
`update-manifest.txt`。标签发布要求四个固定签名 Secrets 全部存在，缺失会失败，
不会把临时签名 APK 伪装成正式更新。普通分支推送仍生成可下载的构建工件。

正式 versionName 来自标签，versionCode 为 `major*1000000+minor*1000+patch`，
每段限制为 0–999，且总值大于 0。发布版本必须递增；预发布标签不进入正式渠道。
CI 预览构建使用独立的 run number 作为 versionCode，不作为正式更新渠道。

应用从官方 Release 的固定 HTTPS 地址获取更新清单，再从对应版本标签下载 APK。
禁止 HTTPS 降级，清单限制 16KB，APK 限制 100MB。校验失败不启动安装器。
每次正式升级仍由 Android 核验签名。功能分支不发布正式 Release；首次使用内置
更新前，需要手动安装包含该更新入口且使用固定签名的版本。

Android 真机还需验证系统安装来源授权、取消安装、相同签名覆盖后 SecureStore
及保险库可继续解锁。CI 编译和逻辑测试不能代替这些系统交互验证。
