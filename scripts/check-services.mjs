import { serviceReadiness } from '../netlify/functions/lib/serviceConfig.js'

const readiness = serviceReadiness()
for (const [label, ready] of Object.entries(readiness)) {
  console.log(`${label}: ${ready ? 'configured' : 'missing configuration'}`)
}
if (!readiness.teamReady || !readiness.aiReady) process.exitCode = 1
