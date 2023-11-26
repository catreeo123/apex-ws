export const sleep = async (time: number) => {
    return new Promise((resolve) => setTimeout(resolve, time))
}

export const customLog = (message: string, metadata?: any) => {
    if (metadata) {
        console.log(JSON.stringify({ message, metadata }))
    } else {
        console.log(JSON.stringify({ message }))
    }
}

export const customDebug = (message: string, metadata?: any) => {
    if (metadata) {
        console.debug(JSON.stringify({ message, status: 'debug', metadata }))
    } else {
        console.debug(JSON.stringify({ message, status: 'debug' }))
    }
}

export const customError = (
    error: string | Record<string, any>,
    metadata?: any,
) => {
    if (typeof error === 'string') {
        console.error(JSON.stringify({ message: error, status: 'error' }))
        return
    }
    let data: Record<string, any> = {
        message: error.message,
        error: {
            message: error.message,
            stack: error.error?.stack || error.stack || error,
        },
        status: 'error',
    }

    if (metadata) {
        data = { ...data, metadata }
    }
    console.error(JSON.stringify(data))
}
