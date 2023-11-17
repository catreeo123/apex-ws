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
const client: ApClient<typeof endpoints> = await apexWebSocket.getClient()
```
