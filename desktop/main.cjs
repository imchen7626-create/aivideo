const { app, BrowserWindow, dialog, shell, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const smokeMode = process.argv.includes('--smoke-test')
const uiTestMode = process.argv.includes('--ui-test')
const testMode = smokeMode || uiTestMode
if (testMode && process.env.STUDIO_TEST_DATA) app.setPath('userData',path.resolve(process.env.STUDIO_TEST_DATA))
const port = testMode ? 31874 : 31873
const origin = `http://127.0.0.1:${port}`
let server, window
const single = app.requestSingleInstanceLock()
if (!single) app.quit()
else {
  app.on('second-instance', () => { if(window){if(window.isMinimized())window.restore();window.show();window.focus()} })
  app.whenReady().then(async () => {
    app.setAppUserModelId('cn.local.aishortdrama.studio')
    const root = app.getAppPath()
    const runtime = await import(pathToFileURL(path.join(root,'scripts','serve-local.mjs')).href)
    server = runtime.startStudioServer({root,dataDirectory:path.join(app.getPath('userData'),'projects'),port})
    await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)})
    // Only the local studio page may write to the clipboard (copy diagnostics / copy text); everything else stays denied.
    session.defaultSession.setPermissionRequestHandler((_webContents,permission,callback,details)=>callback(permission==='clipboard-sanitized-write'&&String(details?.requestingUrl||'').startsWith(origin+'/')))
    window = new BrowserWindow({width:uiTestMode?900:1360,height:uiTestMode?650:900,minWidth:900,minHeight:650,title:uiTestMode?'AI 短剧生产台 · 界面验证':'AI 短剧生产台',show:false,backgroundColor:'#0b0b0f',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}})
    window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))void shell.openExternal(url);return {action:'deny'}})
    window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(origin+'/')){event.preventDefault();if(/^https:\/\//.test(url))void shell.openExternal(url)}})
    window.once('ready-to-show',()=>{if(!smokeMode)window.show()})
    await window.loadURL(origin+(uiTestMode?'/settings':'/'))
    if (uiTestMode) window.setTitle('AI 短剧生产台 · 界面验证')
    if (smokeMode) {
      const html = await fetch(origin+'/').then(r=>r.text())
      const health = await fetch(origin+'/api/bailian/health').then(r=>r.json())
      let frontendReady=false
      for(let attempt=0;attempt<100;attempt++){
        frontendReady=await window.webContents.executeJavaScript('!!document.querySelector(\'[aria-label="自动生产控制台"]\')')
        if(frontendReady)break
        await new Promise(resolve=>setTimeout(resolve,200))
      }
      const resources=await fs.readdir(path.join(root,'dist','assets'))
      const wasm=resources.find(name=>name.endsWith('.wasm')&&name.startsWith('ffmpeg-core-'))
      const core=wasm?await fetch(origin+'/assets/'+wasm):undefined
      const coreBytes=core?.ok?new Uint8Array(await core.arrayBuffer()):new Uint8Array()
      const ffmpegCoreReady=coreBytes.length>30000000&&coreBytes[0]===0&&coreBytes[1]===97&&coreBytes[2]===115&&coreBytes[3]===109
      const report = {packaged:app.isPackaged,version:app.getVersion(),title:window.webContents.getTitle(),pageLoaded:html.includes('<title>AI 短剧生产台</title>'),frontendReady,ffmpegCoreReady,proxyReady:health.ready,dataDirectory:app.getPath('userData')}
      await fs.mkdir(app.getPath('userData'),{recursive:true})
      await fs.writeFile(path.join(app.getPath('userData'),'smoke-report.json'),JSON.stringify(report,null,2))
      app.exit(report.pageLoaded&&report.frontendReady&&report.ffmpegCoreReady&&report.proxyReady?0:1)
    }
  }).catch(async error=>{if(testMode){try{await fs.mkdir(app.getPath('userData'),{recursive:true});await fs.appendFile(path.join(app.getPath('userData'),'startup-error.log'),String(error.stack||error)+'\n')}finally{app.exit(1)}}else{dialog.showErrorBox('AI 短剧生产台启动失败',error.message);app.quit()}})
  app.on('window-all-closed',()=>app.quit())
  app.on('before-quit',()=>{if(server)server.close()})
}
