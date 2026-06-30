package com.huasushis.kryptosmobile

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

@ReactModule(name = KryptosCryptoModule.NAME)
class KryptosCryptoModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  companion object {
    const val NAME = "KryptosCrypto"
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun pbkdf2Sha256(password: String, saltBase64: String, iterationsValue: Double, promise: Promise) {
    var passwordBytes: ByteArray? = null
    var derived: ByteArray? = null
    try {
      if (iterationsValue < 1.0 || iterationsValue > Int.MAX_VALUE.toDouble()) {
        throw IllegalArgumentException("PBKDF2 iterations are out of range")
      }
      val iterations = iterationsValue.toInt()
      if (iterations.toDouble() != iterationsValue) {
        throw IllegalArgumentException("PBKDF2 iterations must be an integer")
      }

      passwordBytes = password.toByteArray(Charsets.UTF_8)
      val salt = Base64.decode(saltBase64, Base64.NO_WRAP)
      derived = pbkdf2HmacSha256(passwordBytes, salt, iterations)
      promise.resolve(Base64.encodeToString(derived, Base64.NO_WRAP))
    } catch (error: Exception) {
      promise.reject("KRYPTOS_PBKDF2_FAILED", error.message, error)
    } finally {
      passwordBytes?.fill(0)
      derived?.fill(0)
    }
  }

  private fun pbkdf2HmacSha256(password: ByteArray, salt: ByteArray, iterations: Int): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(password, "HmacSHA256"))

    val saltBlock = ByteArray(salt.size + 4)
    salt.copyInto(saltBlock)
    saltBlock[saltBlock.size - 1] = 1

    var u = mac.doFinal(saltBlock)
    val derived = u.copyOf()
    try {
      for (i in 1 until iterations) {
        val next = mac.doFinal(u)
        u.fill(0)
        u = next
        for (j in derived.indices) {
          derived[j] = (derived[j].toInt() xor u[j].toInt()).toByte()
        }
      }
      return derived
    } finally {
      saltBlock.fill(0)
      u.fill(0)
    }
  }
}
