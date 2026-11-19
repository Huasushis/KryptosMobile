package com.huasushis.kryptosmobile

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class KryptosUpdateModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val executor = Executors.newSingleThreadExecutor()
  private val client = OkHttpClient.Builder().followRedirects(true).followSslRedirects(false)
    .connectTimeout(10, TimeUnit.SECONDS).callTimeout(180, TimeUnit.SECONDS).build()
  private val releases = "https://github.com/Huasushis/KryptosMobile/releases/"
  override fun getName() = "KryptosUpdate"
  @Suppress("DEPRECATION")
  private fun installed() = context.packageManager.getPackageInfo(context.packageName, 0)
  private fun code(info: android.content.pm.PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
  override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
    "version" to (installed().versionName ?: "unknown"), "versionCode" to code(installed()).toDouble())
  private fun request(url: String) = client.newCall(Request.Builder().url(url).header("User-Agent", "KryptosMobile-Updater").build()).execute()

  @ReactMethod
  fun manifest(promise: Promise) { executor.execute {
    try {
      client.newBuilder().callTimeout(15, TimeUnit.SECONDS).build().newCall(
        Request.Builder().url(releases + "latest/download/update-manifest.txt").build()).execute().use { response ->
        require(response.isSuccessful) { "No stable update release available (HTTP ${response.code})." }
        val stream = response.body?.byteStream() ?: error("Empty release metadata.")
        val bytes = stream.readBytesLimited(16384)
        promise.resolve(bytes.toString(Charsets.UTF_8))
      }
    } catch (error: Exception) { promise.reject("UPDATE_CHECK", error.message, error) }
  } }
  private fun java.io.InputStream.readBytesLimited(limit: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
      val count = read(buffer); if (count < 0) break
      require(output.size() + count <= limit) { "Release metadata too large." }
      output.write(buffer, 0, count)
    }
    return output.toByteArray()
  }
  @Suppress("DEPRECATION")
  private fun signers(info: android.content.pm.PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
    return signatures?.map { digest(it.toByteArray()) }?.toSet() ?: emptySet()
  }
  private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  @ReactMethod
  fun install(url: String, sha256: String, expectedCode: Double, promise: Promise) { executor.execute {
    val directory = File(context.cacheDir, "updates")
    val file = File(directory, "update.apk")
    try {
      require(Regex("https://github\\.com/Huasushis/KryptosMobile/releases/download/v[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}/KryptosMobile-release\\.apk").matches(url)) { "Invalid official release URL." }
      require(Regex("[a-f0-9]{64}").matches(sha256)) { "Invalid release checksum." }
      require(expectedCode.isFinite() && expectedCode % 1.0 == 0.0 && expectedCode > code(installed()) && expectedCode <= 2100000000) { "Update must be newer than the installed app." }
      if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
        context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        promise.resolve("permission"); return@execute
      }
      check(directory.mkdirs() || directory.isDirectory) { "Cannot create update cache." }
      val hash = MessageDigest.getInstance("SHA-256")
      request(url).use { response ->
        require(response.isSuccessful) { "APK download failed (HTTP ${response.code})." }
        val stream = response.body?.byteStream() ?: error("Empty APK.")
        file.outputStream().use { output ->
          val buffer = ByteArray(32768); var total = 0L
          while (true) {
            val count = stream.read(buffer); if (count < 0) break
            total += count; require(total <= 100 * 1024 * 1024) { "APK is too large." }
            hash.update(buffer, 0, count); output.write(buffer, 0, count)
          }
        }
      }
      require(hash.digest().joinToString("") { "%02x".format(it) } == sha256) { "APK checksum mismatch; update cancelled." }
      @Suppress("DEPRECATION")
      val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
      @Suppress("DEPRECATION")
      val archive = context.packageManager.getPackageArchiveInfo(file.absolutePath, flags) ?: error("Invalid APK.")
      @Suppress("DEPRECATION")
      val current = context.packageManager.getPackageInfo(context.packageName, flags)
      require(archive.packageName == context.packageName && code(archive) == expectedCode.toLong()) { "APK package or version does not match this update." }
      require(signers(current).isNotEmpty() && signers(current) == signers(archive)) { "APK signing key differs. Only updates signed with the original release key can preserve this installation." }
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
      context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve("installer")
    } catch (error: Exception) { file.delete(); promise.reject("UPDATE_INSTALL", error.message, error) }
  } }
}
