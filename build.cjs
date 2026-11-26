const fs=require('fs');
const html=fs.readFileSync('src/index.html','utf8');
const model=fs.readFileSync('web/stage-model.js','utf8');
const app=fs.readFileSync('src/app.js','utf8');
const out=html.replace('/*__MODEL__*/',()=>model).replace('/*__APP__*/',()=>app);
fs.writeFileSync('index.html',out,'utf8');
console.log('built',out.length,'bytes');
