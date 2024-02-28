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
     * @default 500
     * Delay before retry to create connection in millisecond
     */
    delayBeforeRetryConnect?: number
    /**
     * @default 'fixed'
     * Delay scale up per attempts for linear type
     */
    delayTypeBeforeRetryConnect: 'fixed' | 'liner'
    /**
     * @default 30000
     * Max delay in millisecond
     */
    maxDelayTimeBeforeRetryConnect: number
    /**
     * @default false
     * Add 2 space of JSON stringify to print debugMode log
     */
    prettyPrint?: boolean

    /**
     * @default 10000
     * Request timeout in millisecond
     */
    requestTimeout?: number
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

// e.g. APClient<typeof endpoints> from const endpoints = string[] as const
export type ApClient<T extends readonly string[]> = Record<
    T[number],
    (params: any) => Promise<any>
>
