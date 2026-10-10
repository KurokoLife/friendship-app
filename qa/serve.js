const http=require('http'),fs=require('fs'),path=require('path');const root=process.argv[2];
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.ttf':'font/ttf','.json':'application/json'};
http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);let cands=[p, p+'.html', path.join(p,'index.html')];
for(const c of cands){const f=path.join(root,c);if(fs.existsSync(f)&&fs.statSync(f).isFile()){res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});return fs.createReadStream(f).pipe(res);}}
res.writeHead(200,{'content-type':'text/html'});fs.createReadStream(path.join(root,'index.html')).pipe(res);}).listen(Number(process.argv[3] || 8099));
