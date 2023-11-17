export interface ApexWebSocketOptions {
    url: string
    onOpen?: (value?: Event) => void
    onClose?: (value?: Event) => void
    credentials: {
        username: string
        password: string
    }
    debugMode?: boolean
    delayBeforeRetryConnectMs?: number
    prettyPrint?: boolean

    endpoints: readonly string[]
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
