import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {SettingsPage} from '../../src/pages/Settings'
import {useSettingsStore} from '../../src/store/settings'
import '../../src/styles/globals.css'
const win=window as unknown as {testResult?:unknown},status=(s:string)=>document.getElementById('status')!.textContent=s
const wait=async(fn:()=>boolean)=>{for(let i=0;i<50;i++){if(fn())return;await new Promise(r=>setTimeout(r,100))}throw new Error('UI condition timed out')}
const check=(v:unknown,m:string)=>{if(!v)throw new Error(m)}
async function run(){
 useSettingsStore.getState().resetAll();createRoot(document.getElementById('root')!).render(<MemoryRouter><SettingsPage/></MemoryRouter>)
 await wait(()=>!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('添加')))
 Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('添加'))!.click()
 await wait(()=>!!document.querySelector('[role=dialog]'))
 const dialog=document.querySelector('[role=dialog]')!,form=dialog.querySelector('form')!,footer=dialog.querySelector<HTMLButtonElement>('button[type=submit]')!
 const rect=footer.getBoundingClientRect();check(rect.bottom<=innerHeight&&rect.top>=0,'Save button is outside window')
 const scroll=dialog.querySelector<HTMLElement>('.overflow-y-auto')!;check(scroll.scrollHeight>scroll.clientHeight,'Settings does not have a scrollable body')
 scroll.scrollTop=scroll.scrollHeight;check(scroll.scrollTop>0,'Settings body cannot scroll')
 const input=(label:string,value:string)=>{const field=Array.from(form.querySelectorAll('label')).find(l=>l.textContent?.includes(label))!.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}))}
 input('显示名称','独立语音服务');input('Base URL','https://example.invalid/v1');input('模型名','speech-fixture')
 const kind=form.querySelector('select')!;kind.value='tts';kind.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,100));footer.click()
 await wait(()=>!document.querySelector('[role=dialog]'))
 check(useSettingsStore.getState().providers.some(p=>p.kind==='tts'&&p.model==='speech-fixture'),'Save did not persist speech provider')
 status('900×650 设置页滚动、固定提交按钮、语音配置保存通过')
 win.testResult={passed:true,viewport:[innerWidth,innerHeight],scrollable:true,saveVisible:true,speechProviderSaved:true,footer:{top:rect.top,bottom:rect.bottom}}
}
run().catch(e=>{status(String(e));win.testResult={passed:false,error:e instanceof Error?e.stack:String(e)}})
