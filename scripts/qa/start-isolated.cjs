/* eslint-disable @typescript-eslint/no-require-imports -- Directly executable CommonJS audit driver. */
const fs=require('node:fs');
const {spawnSync,spawn}=require('node:child_process');
require('dotenv').config({quiet:true});
const {Client}=require('pg');
(async()=>{
 const original=new URL(process.env.DATABASE_URL);
 const db=process.env.QA_DATABASE || 'rolespec_frontend_qa_20261112';
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(db) || db===original.pathname.slice(1))throw new Error('QA_DATABASE must be a separate lowercase PostgreSQL database name');
 const container=process.env.QA_POSTGRES_CONTAINER || 'rolespec-pg';
 const admin=new Client({connectionString:process.env.DATABASE_URL});await admin.connect();
 const exists=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[db]);
 if(!exists.rowCount){
  await admin.query('CREATE DATABASE "'+db+'"');
  const dump=spawnSync('docker',['exec',container,'pg_dump','-U',decodeURIComponent(original.username),'-d',original.pathname.slice(1),'-Fc'],{maxBuffer:128*1024*1024,windowsHide:true});
  if(dump.status!==0)throw new Error('pg_dump failed');
  const restore=spawnSync('docker',['exec','-i',container,'pg_restore','-U',decodeURIComponent(original.username),'-d',db,'--no-owner'],{input:dump.stdout,maxBuffer:8*1024*1024,windowsHide:true});
  if(restore.status!==0)throw new Error('pg_restore failed');
 }
 await admin.end();original.pathname='/'+db;
 const mode=process.env.QA_SERVER_MODE==='production'?'start':'dev';
 const port=process.env.QA_PORT || '3100';
 if(!/^\d+$/.test(port)||Number(port)<1024||Number(port)>65535)throw new Error('QA_PORT must be 1024–65535');
 fs.mkdirSync('.unlazy/qa/evidence',{recursive:true});
 fs.writeFileSync(`.unlazy/qa/evidence/environment-${mode}-${port}.json`,JSON.stringify({database:db,startedAt:new Date().toISOString(),mode,port,host:'127.0.0.1',isolated:true},null,2));
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next',mode,'-p',port,'--hostname','127.0.0.1'],{env:{...process.env,DATABASE_URL:original.toString(),ROLSPEC_ACCESS_MODE:'local'},stdio:'inherit',windowsHide:true});
 child.on('exit',code=>process.exit(code||0));
})().catch(e=>{console.error(e.message);process.exit(1)});
