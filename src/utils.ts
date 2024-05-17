export const sleep = async (time: number) => {
    return new Promise((resolve) => setTimeout(resolve, time))
}

export const customLog = ({
    message,
    metadata,
}: {
    message: string
    metadata?: Record<string, any>
}) => {
    if (metadata) {
        console.log(JSON.stringify({ message, metadata }))
    } else {
        console.log(JSON.stringify({ message }))
    }
}

export const customDebug = ({
    message,
    metadata,
}: {
    message: string
    metadata?: Record<string, any>
}) => {
    if (metadata) {
        console.debug(JSON.stringify({ message, status: 'debug', metadata }))
    } else {
        console.debug(JSON.stringify({ message, status: 'debug' }))
    }
}

export const customError = ({
    message,
    error,
    metadata,
}: {
    message: string
    error?: Record<string, any>
    metadata?: Record<string, any>
}) => {
    if (!error) {
        console.error(JSON.stringify({ message, status: 'error' }))
        return
    }
    let data: Record<string, any> = {
        message: message,
        error: {
            message: error.message,
            stack: error.error?.stack || error.stack || error,
            cause: error.cause
                ? { message: error.cause.message, stack: error.cause.stack }
                : undefined,
        },
        status: 'error',
    }

    if (metadata) {
        data = { ...data, metadata }
    }
    console.error(JSON.stringify(data))
}

export const convertErrorToJSON = (error: unknown) => {
    if (!(error instanceof Error)) {
        return error
    }
    let cause
    if ('cause' in error) {
        cause = convertErrorToJSON(error.cause)
    }
    return {
        message: error.message,
        stack: error.stack,
        kind: error.name,
        cause,
    }
}
