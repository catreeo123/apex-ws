export interface ApexWebSocketOptions {
    // AP websocket server url
    url: string
    // custom function to run when the websocket connected
    onOpen?: (value?: Event) => void
    // custom function to run when the websocket closed
    onClose?: (value?: Event) => void
    // username and password of AP account
    credentials: {
        username: string
        password: string
    }
    // log more information in the send seq, function name, and payload
    debugMode?: boolean

    // delay before retry to create connection in millisecond
    delayBeforeRetryConnectMs?: number
    // add 2 space of JSON stringify to print debugMode log
    prettyPrint?: boolean
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
