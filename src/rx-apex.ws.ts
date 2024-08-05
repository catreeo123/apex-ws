import {
    BehaviorSubject,
    config,
    distinctUntilChanged,
    exhaustMap,
    filter,
    lastValueFrom,
    mergeMap,
    Observable,
    retry,
    skip,
    Subject,
    take,
    tap,
    throwError,
    timeout,
    timer,
} from 'rxjs'
import { webSocket, WebSocketSubject } from 'rxjs/webSocket'
import * as safeJsonStringify from 'safe-json-stringify'
import * as WebSocket from 'ws'
import {
    ApexWebSocketOptions,
    MessageFrame,
    MessageFrameType,
} from './apex-ws.interface'
import { customDebug, customError, customLog } from './utils'

export class RxApexWebSocket {
    private options: ApexWebSocketOptions

    #status$ = new BehaviorSubject<boolean>(false)
    #isLogin$ = new BehaviorSubject<boolean>(false)
    ws: WebSocketSubject<MessageFrame> | undefined
    messages$ = new Subject<MessageFrame>()

    #retryCount = 0
    #seq = 0
    #debugMode = false

    private logger: ApexWebSocketOptions['logger'] = {
        log: customLog,
        error: customError,
        debug: customDebug,
    }

    constructor(options: ApexWebSocketOptions) {
        this.options = {
            prettyPrint: false,
            delayBeforeRetryConnect: 1000,
            delayTypeBeforeRetryConnect: 'fixed',
            maxDelayTimeBeforeRetryConnect: 30000,
            requestTimeout: 10000,
            ...options,
            ping: {
                interval: 300000,
                failedDelay: 30000,
                retryTimes: 5,
                ...options.ping,
            },
        }
        this.#debugMode = !!options.debugMode
        if (options.logger) {
            this.logger = options.logger
        }
        config.onUnhandledError = (err) => {
            this.logger.error({
                message: 'unhandled error of rxjs',
                error: {
                    message: err.message,
                    stack: err.stack,
                    kind: err.name,
                },
            })
        }
    }

    connect() {
        this.createWebSocket()
        this.connectionStatus$
            .pipe(
                skip(1),
                filter((status) => !status),
                exhaustMap(() =>
                    timer(this.calculateBackOffDelay(this.#retryCount)).pipe(
                        tap(() => {
                            this.#retryCount += 1
                            this.createWebSocket()
                        }),
                    ),
                ),
            )
            .subscribe()
    }

    private async createClient() {
        this.createWebSocket()
    }

    private createWebSocket() {
        if (this.ws) {
            this.ws.unsubscribe()
        }
        const openObserver = new Subject<Event>()
        openObserver.subscribe(() => {
            this.logger.log({ message: 'AP: Connection established' })
            this.#status$.next(true)
            this.login()
        })
        const closeObserver = new Subject<CloseEvent>()
        closeObserver.subscribe(() => {
            this.logger.log({ message: 'AP: Received close event' })
            this.#status$.next(false)
        })

        this.ws = webSocket({
            url: this.options.url,
            openObserver,
            closeObserver,
            serializer: (value: MessageFrame) => {
                return this.serializer(value)
            },
            deserializer: (e: MessageEvent) => {
                return this.deserializer(e.data)
            },
            WebSocketCtor: (WebSocket as any).WebSocket,
        })

        this.ws
            .pipe(
                retry({
                    delay: (error, retryCount) => {
                        this.#status$.next(false)
                        this.logger.error({
                            message: `AP: Connection error: ${error.message}. Retry to connect`,
                            error: {
                                message: error.message,
                                stack: error.stack,
                                kind: error.name,
                            },
                        })
                        const timeout = this.calculateBackOffDelay(retryCount)
                        return timer(timeout)
                    },
                }),
            )
            .subscribe({
                next: (message) => {
                    // this.messages$.next(message)
                },
            })
    }

    private serializer(value: object): string {
        for (const key in value) {
            if (
                typeof value[key] === 'object' &&
                !Array.isArray(value[key]) &&
                value[key] !== null
            ) {
                value[key] = this.serializer(value[key])
            }
        }
        return safeJsonStringify(value)
    }

    private deserializer(value: string): any {
        try {
            return JSON.parse(value, (key, val) => {
                const regex = /[{[].*[}\]]/g
                if (typeof val === 'string' && regex.test(val)) {
                    return this.deserializer(val)
                }
                return val
            })
        } catch (exc) {
            return value
        }
    }

    private calculateBackOffDelay(retryCount: number): number {
        let timeout = this.options.delayBeforeRetryConnect
        if (this.options.delayTypeBeforeRetryConnect === 'liner') {
            timeout = Math.min(
                this.options.delayBeforeRetryConnect * retryCount,
                this.options.maxDelayTimeBeforeRetryConnect,
            )
        }
        const randomDelay = Math.floor(Math.random() * 4000) + 1000
        return timeout + randomDelay
    }

    private get connectionStatus$(): Observable<boolean> {
        return this.#status$.pipe(distinctUntilChanged())
    }

    private get loginStatus$(): Observable<boolean> {
        return this.#isLogin$.pipe(distinctUntilChanged())
    }

    get connectionStatus(): Promise<boolean> {
        return lastValueFrom(this.connectionStatus$.pipe(take(1)))
    }

    sendMessage(message: MessageFrame) {
        if (this.#debugMode) {
            const dataToLog = {
                ...(message.o as Record<string, any>),
            }
            if ('password' in dataToLog) {
                delete dataToLog.password
            }
            this.logger.debug({
                message: `AP: ${message.n} (${message.i}): ${safeJsonStringify(
                    dataToLog,
                )}`,
                metadata: dataToLog,
            })
        }
        // send message only if connection is still connected
        this.connectionStatus$
            .pipe(
                filter((status) => status),
                tap(() => {
                    this.ws.next(message)
                }),
                take(1),
            )
            .subscribe()
    }

    private RPCCall(
        functionName: string,
        data: Record<string, any>,
        seq: number,
    ) {
        this.checkWebsocketConnection()
        const messageFrame: MessageFrame = {
            m: MessageFrameType.REQUEST,
            i: seq,
            n: functionName,
            o: data,
        }
        this.#seq += 2
        this.sendMessage(messageFrame)
    }

    private RPCPromise(
        functionName: string,
        params: Record<string, any>,
        timeoutMs?: number,
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            const seq = this.#seq
            this.messages$
                .pipe(
                    timeout({
                        each: timeoutMs,
                        with: () => {
                            throw new Error(
                                `AP ${functionName} ${seq}: Request Timeout`,
                            )
                        },
                    }),
                    filter(
                        (message) =>
                            message.n === functionName &&
                            message.i === seq &&
                            message.m === MessageFrameType.REPLY,
                    ),
                    take(1),
                )
                .subscribe({
                    next: (data) => resolve(data.o),
                    error: (error: Error) => reject(error),
                })
            this.RPCCall(functionName, params, seq)
        })
    }

    private checkWebsocketConnection() {
        this.connectionStatus$
            .pipe(
                take(1),
                filter((status) => !status),
                mergeMap(() =>
                    throwError(
                        () => new Error('AP: Websocket is not connected'),
                    ),
                ),
            )
            .subscribe({
                error: (error) => {
                    this.logger.error({
                        message: error.message,
                        error: {
                            message: error.message,
                            stack: error.stack,
                            kind: error.name,
                        },
                    })
                    throw error
                },
            })
    }

    private async login() {
        try {
            const credentials = this.options.credentials
            this.logger.log({ message: 'AP: Pending Login' })
            const result = await this.authenticateUser(credentials)
            this.#isLogin$.next(result.Authenticated)
            const maskToken =
                result.SessionToken?.slice(0, -12) + '************'
            this.logger.log({
                message: `AP ${credentials.username}: AuthenticateUser`,
                metadata: {
                    authenticate: result.Authenticated,
                    sessionToken: maskToken,
                },
            })
        } catch (error) {
            this.logger.error({
                message: `AP: login error: ${error.message}`,
                error: {
                    message: error.message,
                    stack: error.stack,
                    kind: error.name,
                },
            })
            this.#isLogin$.next(false)
        }
    }

    private authenticateUser({
        username,
        password,
    }: {
        username: string
        password: string
    }): Promise<{
        Authenticated: boolean
        SessionToken: string
    }> {
        return this.RPCPromise(
            'AuthenticateUser',
            { username, password },
            10000,
        )
    }
}
