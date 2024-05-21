# APEX WS

## Installation

```bash
npm i apex-ws
```

## Usage

```typescript
import { ApexWebSocket } from 'apex-ws'

const endpoints = ['AP function name'] as const

// type for using in class
export type AlphaPoint = Record<
    (typeof endpoints)[number],
    Awaited<ReturnType<ApexWebSocket['getClient']>>[string]
>

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

// params will be object send with request
try {
    const result = await client.functionName1(params)
} catch (error) {
    // handle reject promise here for error
    console.error(error)
    // rethrow error if need
    throw error
}
```

## Options

```typescript
export interface ApexWebSocketOptions {
    /**
     * AP websocket server url
     */
    url: string
    /**
     * Custom function to run when the websocket connected
     * @param value
     * @returns
     */
    onOpen?: (value?: Event) => void
    /**
     * Custom function to run when the websocket closed
     * @param value
     * @returns
     */
    onClose?: (value?: Event) => void
    /**
     * Username and Password of AP account
     */
    credentials: {
        username: string
        password: string
    }
    /**
     * @default false
     * Log more information in the send seq, function name, and payload
     */
    debugMode?: boolean

    /**
     * @default 1000
     * Delay before retry to create connection in millisecond
     */
    delayBeforeRetryConnect?: number
    /**
     * @default 'fixed'
     * Delay scale up per attempts for linear type
     */
    delayTypeBeforeRetryConnect?: 'fixed' | 'liner'
    /**
     * @default 30000
     * Max delay in millisecond
     */
    maxDelayTimeBeforeRetryConnect?: number
    /**
     * @default false
     * Add 2 space of JSON stringify to print debugMode log
     * now have problem with JSON.string in my custom log so didn't need this for a while
     */
    prettyPrint?: boolean

    /**
     * @default 10000
     * Request timeout in millisecond
     */
    requestTimeout?: number

    /**
     * Custom logger like nestjs-winston
     * my log input will be ({message, metadata}) and ({message, error, metadata})
     */
    logger?: {
        log: (...args: any[]) => any
        error: (...args: any[]) => any
        debug: (...args: any[]) => any
    }

    /** opposum circuit breaker option https://nodeshift.dev/opossum/#circuitbreaker
     * global circuit breaker options setting for each endpoint.
     */
    circuitBreaker?: Omit<CircuitBreakerType.Options, 'timeout'>
}
```

config force throw error, retry, and individual time out for each endpoint 

```typescript
try {
    const result = await client.functionName1(params, 
    { 
        forceThrowError:true, // default false. So it didn't throw error
        maxRetry: 2,
        timeoutMs: 10000 // 10s timeout ignore the global config
     })
} catch (error) {
    console.error(error)
    throw error
}
```
