const {app,BrowserWindow}=require('electron')
const path=require('node:path'),fs=require('node:fs/promises')
const root=path.resolve(__dirname,'..'),out=path.join(root,'work','composition-test')
const ui=process.argv.includes('--ui'),automation=process.argv.includes('--automation'),live=process.argv.includes('--live-text'),reportName=live?'真实文本模型验证':automation?'全自动生产验证':ui?'自动剪辑界面验证':'剪辑流水线验证'
const settings=process.argv.includes('--settings')
const restartSeed=process.argv.includes('--restart-seed'),restartCheck=process.argv.includes('--restart-check'),restart=restartSeed||restartCheck
app.setPath('userData',path.join(out,restart?'restart-data':'electron-data'))
const log=async message=>{await fs.mkdir(out,{recursive:true});await fs.appendFile(path.join(out,'verification.log'),String(message)+'\n')}
app.whenReady().then(async()=>{
 const {startStudioServer}=await import('../scripts/serve-local.mjs')
 const server=startStudioServer({root:out,dataDirectory:path.join(out,'database'),port:31876})
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)})
 const window=new BrowserWindow({width:settings?900:1000,height:settings?650:800,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}})
 await window.loadURL('http://127.0.0.1:31876/tests/fixtures/'+(restart?'restart.html?phase='+(restartSeed?'seed':'check'):settings?'settings.html':live?'live-text.html':automation?'automation.html':ui?'pipeline-ui.html':'composition.html'))
 if(live){const settings=require('../work/read-local-settings.cjs').parseSettings();if(!settings)throw new Error('No local model configuration');const get=kind=>settings.providers.find(p=>p.kind===kind&&p.id===settings.activeProviderIds[kind]);const llm=get('llm'),video=get('image2video');if(!llm||!video)throw new Error('Missing configured model');await window.webContents.executeJavaScript('window.liveProviders='+JSON.stringify({llm,video}))}
 const started=Date.now()
 while(Date.now()-started<600000){
  const result=await window.webContents.executeJavaScript('window.testResult || null')
  if(result){
   const {finalBase64,packageBase64,contactSheetBase64,liveFiles,...report}=result
   await fs.mkdir(path.join(root,'outputs'),{recursive:true})
   if(finalBase64)await fs.writeFile(path.join(root,'outputs',automation?'自动生产验证成片.mp4':'流水线验证成片.mp4'),Buffer.from(finalBase64,'base64'))
   if(packageBase64)await fs.writeFile(path.join(root,'outputs','验证成片包-1.1.0.zip'),Buffer.from(packageBase64,'base64'))
   if(contactSheetBase64)await fs.writeFile(path.join(root,'outputs','真实镜头抽帧-1.1.0.jpg'),Buffer.from(contactSheetBase64,'base64'))
   if(liveFiles){await fs.mkdir(path.join(root,'outputs','真实模型创作验证'),{recursive:true});await fs.writeFile(path.join(root,'outputs','真实模型创作验证','小说.txt'),liveFiles.novel.text,'utf8');await fs.writeFile(path.join(root,'outputs','真实模型创作验证','制作清单.json'),JSON.stringify(liveFiles,null,2))}
   const outputName=restart?(restartSeed?'重启恢复准备':'重启恢复验证'):settings?'设置页小窗口验证':reportName
   await fs.writeFile(path.join(root,'outputs',outputName+'.json'),JSON.stringify(report,null,2))
   await window.webContents.capturePage().then(img=>fs.writeFile(path.join(root,'outputs',outputName+'.png'),img.toPNG()))
   await log(JSON.stringify(report,null,2));app.exit(report.passed?0:1);return
  }
  await log(await window.webContents.executeJavaScript('document.getElementById("status").textContent'))
  await new Promise(resolve=>setTimeout(resolve,5000))
 }
 throw new Error('Composition verification timed out')
}).catch(async e=>{await log(e.stack||e);app.exit(1)})
