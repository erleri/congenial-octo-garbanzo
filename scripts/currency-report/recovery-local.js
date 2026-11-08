// Read-only default. Does not connect to Docker/DB, restore files, or load keys.
import {inspectRecoveryReferences} from './recovery.js'
inspectRecoveryReferences().then(result=>console.log(JSON.stringify(result,null,2))).catch(()=>{console.error('local_recovery_inventory_failed');process.exitCode=1})
