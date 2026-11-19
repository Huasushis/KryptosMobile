package com.huasushis.kryptosmobile

import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

internal fun createWebDavClient(): OkHttpClient = OkHttpClient.Builder()
  // gzip can turn a server's strong ETag into W/"...". Read the original
  // representation so its validator can safely guard the subsequent PUT.
  .addInterceptor { chain ->
    chain.proceed(chain.request().newBuilder().header("Accept-Encoding", "identity").build())
  }
  .followRedirects(false).followSslRedirects(false)
  .callTimeout(30, TimeUnit.SECONDS).build()
