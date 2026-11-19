package com.huasushis.kryptosmobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class KryptosCryptoPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(KryptosCryptoModule(reactContext), KryptosWebDavModule(reactContext), KryptosUpdateModule(reactContext))
  }

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<in Nothing, in Nothing>> {
    return emptyList()
  }
}
