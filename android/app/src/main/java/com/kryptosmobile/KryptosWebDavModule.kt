package com.huasushis.kryptosmobile

import com.facebook.react.bridge.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

class KryptosWebDavModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val calls = ConcurrentHashMap<String, Call>()
  private val client = createWebDavClient()

  override fun getName() = "KryptosWebDav"

  @ReactMethod
  fun cancel(id: String) { calls[id]?.cancel() }

  @ReactMethod
  fun request(id: String, url: String, method: String, headers: ReadableMap, body: String?, promise: Promise) {
    try {
      require(method in listOf("GET", "MKCOL", "PROPFIND", "PUT"))
      val builder = Request.Builder().url(url)
      val keys = headers.keySetIterator()
      while (keys.hasNextKey()) {
        val key = keys.nextKey()
        builder.header(key, headers.getString(key) ?: "")
      }
      val payload = if (method == "GET") null else (body ?: "").toRequestBody(
        (if (headers.hasKey("Content-Type")) headers.getString("Content-Type")!! else "text/plain; charset=utf-8").toMediaType())
      val call = client.newCall(builder.method(method, payload).build())
      calls[id] = call
      call.enqueue(object : okhttp3.Callback {
        override fun onFailure(call: Call, error: IOException) {
          calls.remove(id)
          promise.reject("WEBDAV_NETWORK", "WebDAV request failed or was cancelled.")
        }
        override fun onResponse(call: Call, response: Response) {
          try {
            response.use {
              val source = it.body?.source()
              source?.request(2_000_001)
              val bytes = source?.buffer?.readByteArray() ?: byteArrayOf()
              require(bytes.size <= 2_000_000) { "WebDAV response is too large." }
              val result = Arguments.createMap()
              result.putInt("status", it.code)
              result.putString("body", bytes.toString(Charsets.UTF_8))
              it.header("ETag")?.let { tag -> result.putString("etag", tag) }
              promise.resolve(result)
            }
          } catch (error: Exception) {
            promise.reject("WEBDAV_RESPONSE", error.message)
          } finally { calls.remove(id) }
        }
      })
    } catch (error: Exception) { promise.reject("WEBDAV_REQUEST", error.message) }
  }

  override fun invalidate() {
    calls.values.forEach { it.cancel() }
    super.invalidate()
  }
}
