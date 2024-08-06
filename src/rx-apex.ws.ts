import {
    BehaviorSubject,
    concatMap,
    config,
    distinctUntilChanged,
    exhaustMap,
    filter,
    from,
    lastValueFrom,
    mergeMap,
    Observable,
    OperatorFunction,
    retry,
    skip,
    Subject,
    take,
    takeUntil,
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
        config.onUnhandledError = (error) => {
            this.logger.error({
                message: `unhandled error of rxjs ${error.message}`,
                // error: {
                //     message: err.message,
                //     stack: err.stack,
                //     kind: err.name,
                // },
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
        this.logger.log({ message: 'AP: Creating Websocket' })
        if (this.ws) {
            this.ws.unsubscribe()
        }
        this.#seq = 0
        const openObserver = new Subject<Event>()
        openObserver
            .pipe(
                tap(() => {
                    this.logger.log({ message: 'AP: Connection established' })
                    this.#status$.next(true)
                }),
                concatMap(() => from(this.login())),
                tap(() => {
                    this.logger.log({
                        message: `AP: Websocket start successfully`,
                    })
                }),
                concatMap(() =>
                    timer(0, this.options.ping.interval).pipe(
                        tap(console.log),
                        concatMap(() => {
                            return from(this.RPCPromise('Ping', {})).pipe(
                                retry({
                                    count: this.options.ping.retryTimes,
                                    delay: () => {
                                        console.log('retry')
                                        return timer(
                                            this.options.ping.failedDelay,
                                        )
                                    },
                                }),
                            )
                        }),
                        takeUntil(this.connectionStatus$.pipe(skip(1))),
                    ),
                ),
            )
            .subscribe({
                next: (message) => {
                    this.logger.log({
                        message: `AP: Ping successfully return message: ${message?.msg}`,
                    })
                },
                error: (error) => {
                    this.logger.error({
                        message: `AP: Open Observer error ${error.message}`,
                        // error: {
                        //     message: error.message,
                        //     stack: error.stack,
                        //     kind: error.name,
                        // },
                    })
                    this.#status$.next(false)
                },
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
                    this.messages$.next(message)
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
        const messageFrame: MessageFrame = this.createMessageFrame(
            seq,
            functionName,
            data,
        )
        this.sendMessage(messageFrame)
    }

    private createMessageFrame(
        seq: number,
        functionName: string,
        data: Record<string, any>,
    ) {
        const messageFrame: MessageFrame = {
            m: MessageFrameType.REQUEST,
            i: seq,
            n: functionName,
            o: data,
        }
        this.#seq += 2
        return messageFrame
    }

    private RPCPromise(
        functionName: string,
        params: Record<string, any>,
        timeoutMs?: number,
    ): Promise<any> {
        return new Promise((resolve, reject) => {
            const seq = this.#seq
            this.checkWebsocketConnection({ functionName, seq })
            this.messages$
                .pipe(
                    filter(
                        (message) =>
                            message.n === functionName &&
                            message.i === seq &&
                            message.m === MessageFrameType.REPLY,
                    ),
                    this.requestTimeout(functionName, seq, timeoutMs),
                    take(1),
                )
                .subscribe({
                    next: (data) => resolve(data.o),
                    error: (error: Error) => reject(error),
                })
            this.RPCCall(functionName, params, seq)
        })
    }

    private checkWebsocketConnection({
        functionName,
        seq,
    }: {
        functionName: string
        seq: number
    }) {
        this.connectionStatus$
            .pipe(
                take(1),
                filter((status) => !status),
                mergeMap(() =>
                    throwError(
                        () =>
                            new Error(
                                `AP ${functionName} ${seq}: Websocket is not connected`,
                            ),
                    ),
                ),
            )
            .subscribe({
                error: (error) => {
                    this.logger.error({
                        message: error.message,
                        // error: {
                        //     message: error.message,
                        //     stack: error.stack,
                        //     kind: error.name,
                        // },
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
            // this.logger.error({
            //     message: `AP: login error: ${error.message}`,
            //     error: {
            //         message: error.message,
            //         stack: error.stack,
            //         kind: error.name,
            //     },
            // })
            this.#isLogin$.next(false)
            throw error
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

    private requestTimeout<T>(
        functionName: string,
        seq: number,
        timeoutMs?: number,
    ): OperatorFunction<T, T> {
        return timeout({
            each: timeoutMs || this.options.requestTimeout,
            with: () =>
                throwError(
                    () =>
                        new Error(`AP ${functionName} ${seq}: Request Timeout`),
                ),
        })
    }
}
