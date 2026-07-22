import assert from 'node:assert';
import { readFileSync, symlinkSync, unlinkSync, existsSync } from 'node:fs';
const BASE=process.env.ATLAN_BASE, TOKEN=(process.env.ATLAN_TOKEN??readFileSync(new URL('../.auth-token',import.meta.url),'utf8')).trim();
const api=(p,o={})=>fetch(BASE+p,{...o,headers:{'content-type':'application/json','x-atlan-token':TOKEN,...(o.headers??{})}});
const link='/root/atlan/.attachments/evil-link';
try{ if(existsSync(link)) unlinkSync(link); symlinkSync('/etc/passwd', link); }catch(e){}
const r1=await api('/api/file?path='+encodeURIComponent(link));
const r2=await api('/api/attach/ref',{method:'POST',body:JSON.stringify({path:link})});
console.log('read symlink→/etc/passwd blocked:', r1.status===400, '('+r1.status+')');
console.log('attach symlink→/etc/passwd blocked:', r2.status===400, '('+r2.status+')');
try{ unlinkSync(link); }catch(e){}
assert.ok(r1.status===400 && r2.status===400, 'symlink escape not blocked');
console.log('SYMLINK GUARD OK');
