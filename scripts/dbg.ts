process.on('unhandledRejection', (r) => console.error('UNHANDLED:', r));
console.log('start');
class R<T=unknown> { result!: T; onsuccess: any=null; onerror: any=null; }
class TX {
  error: any=null; oncomplete:any=null; onabort:any=null; onerror:any=null;
  private aborted=false; private pending: Array<()=>void>=[];
  constructor(private store: Map<string,unknown>){}
  schedule(fn: ()=>void){ this.pending.push(()=>{ try{fn();}catch(e){console.log('caught in schedule', (e as Error).message); this.abort();} }); }
  async run(){ for(const s of this.pending){ if(this.aborted)break; s(); await Promise.resolve(); } if(!this.aborted){ queueMicrotask(()=>this.oncomplete?.(new Event('c'))); } }
  abort(){ this.aborted=true; this.pending=[]; queueMicrotask(()=>this.onabort?.(new Event('a'))); }
  objectStore(){ return new S(this.store, this); }
}
class S {
  constructor(private d: Map<string,unknown>, private tx: TX){}
  put(v:{id:string}){ const r=new R(); this.tx.schedule(()=>{ this.d.set(v.id, structuredClone(v)); r.result=v.id; r.onsuccess?.(new Event('ok')); }); return r; }
}
class DB { constructor(private d: Map<string,unknown>){} transaction(){ const tx=new TX(this.d); void tx.run(); return tx; } close(){} }
class IDB { constructor(private d=new Map<string,unknown>()){} open(){ const r=new R<DB>(); queueMicrotask(()=>{ r.result=new DB(this.d); r.onsuccess?.(new Event('ok')); }); return r; } }
(globalThis as any).indexedDB = new IDB();
const { saveProject } = await import('../src/lib/db.ts');
console.log('imported');
const { p6mSample } = await import('../src/lib/samples.ts');
await saveProject(p6mSample());
console.log('saved ok');
