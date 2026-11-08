import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'
import { localDbConfig } from './scripts/currency-report/local-db.js'

// Production connection/code path with only an isolated local public credential.
// The real feature flag is unchanged. No service key or Node writer enters this build.
export default defineConfig(async()=>{
  const config=await localDbConfig()
  return mergeConfig(base,{
    envDir:false,envPrefix:'LOCAL_REPORT_PUBLIC_',base:'/',
    define:{__LOCAL_CURRENCY_REPORTS__:false,
      'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(config.url),
      'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify(config.anonKey),
      'import.meta.env.VITE_FX_DATA_SOURCE':JSON.stringify('json'),
      'import.meta.env.VITE_USAGE_ENABLED':JSON.stringify('false')},
    plugins:[{name:'ui2-production-path-preview',enforce:'pre',
      resolveId(source:string){if(source==='./generated/fxReportConfig')return '\0ui2-preview-flag'},
      load(id:string){if(id==='\0ui2-preview-flag')return 'export const fxReportConfig={enabled:true}'},
      transformIndexHtml(html:string){return html.replace('<body>','<body><p style="margin:0;padding:8px 16px;background:#fff4d9;color:#6b4c17;font:13px system-ui">배포용 코드 미리보기 · 격리 로컬 DB · 운영 반영 없음</p>')},
    }],
    build:{outDir:'dist-ui2-preview'},
    preview:{host:'127.0.0.1',port:4177,strictPort:true},
  })
})
