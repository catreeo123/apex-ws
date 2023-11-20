```typescript
import { ApexWebSocket } from 'apex-ws'

const endpoints = ['AP function name'] as const

const apexWebSocket = new ApexWebSocket({
            url: config.alphaPoint.alphaPointWebsocketURL,
            credentials: {
                username: config.alphaPoint.alphaPointUsername,
                password: config.alphaPoint.alphaPointPassword,
            },
            endpoints: endpoints,
        })
// if using value variable need making it as const like define above
const client = await apexWebSocket.getClient(endpoints)
// OR can pass array directly to making autocomplete of endpoint work
const client = await apexWebSocket.getClient(['functionName1', 'functionName2'])
```
