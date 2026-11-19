package com.huasushis.kryptosmobile

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPOutputStream

class WebDavClientTest {
  @Test fun originalRepresentationKeepsStrongValidatorAndRejectsConcurrentWrite() {
    val body = "encrypted backup fixture"
    val compressed = ByteArrayOutputStream().also { output ->
      GZIPOutputStream(output).use { it.write(body.toByteArray()) }
    }.toByteArray()
    var tag = "\"original\""
    MockWebServer().use { server ->
      server.dispatcher = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
          if (request.method == "GET") {
            if (request.getHeader("Accept-Encoding")?.contains("gzip") == true) {
              return MockResponse().setHeader("ETag", "W/$tag")
                .setHeader("Content-Encoding", "gzip").setBody(Buffer().write(compressed))
            }
            return MockResponse().setHeader("ETag", tag).setBody(body)
          }
          return MockResponse().setResponseCode(if (request.getHeader("If-Match") == tag) 204 else 412)
        }
      }
      server.start()
      val request = Request.Builder().url(server.url("/Kryptos/kryptos-sync.txt")).build()
      // Reproduce the response produced by servers with gzip enabled.
      OkHttpClient().newCall(request).execute().use { response ->
        assertEquals("W/$tag", response.header("ETag"))
        assertEquals(body, response.body!!.string())
      }
      val client = createWebDavClient()
      val validator = client.newCall(request).execute().use { response ->
        assertEquals(tag, response.header("ETag"))
        assertEquals(body, response.body!!.string())
        response.header("ETag")!!
      }
      server.takeRequest()
      assertEquals("identity", server.takeRequest().getHeader("Accept-Encoding"))
      val put = request.newBuilder().header("If-Match", validator).put(body.toRequestBody()).build()
      client.newCall(put).execute().use { assertEquals(204, it.code) }
      tag = "\"changed-by-another-device\""
      client.newCall(put).execute().use { assertEquals(412, it.code) }
    }
  }
}
