import * as CircuitBreaker from 'opossum'
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

    // opposum circuit breaker option https://nodeshift.dev/opossum/#circuitbreaker
    // global circuit breaker options setting for each endpoint.
    circuitBreaker?: CircuitBreaker.Options
}

export const enum MessageFrameType {
    REQUEST = 0,
    REPLY = 1,
    SUBSCRIBE_TO_EVENT = 2,
    EVENT = 3,
    UNSUBSCRIBE_FROM_EVENT = 4,
    ERROR = 5,
}

export type TypeMessageFrameType =
    (typeof MessageFrameType)[keyof typeof MessageFrameType]

export interface MessageFrame {
    m: MessageFrameType
    i: number
    n: string
    o: Record<string, any> | string
}

export interface EndpointOptions {
    forceThrowError?: boolean
    maxRetry?: number
}

// e.g. APClient<typeof endpoints> from const endpoints = string[] as const
export type ApClient<T extends readonly string[]> = Record<
    T[number],
    (params: any) => Promise<any>
>
