#!/bin/bash

TIMEOUT=60
QUIET=0

wait_for() {
    for i in `seq $TIMEOUT` ; do
        nc -z "$HOST" "$PORT" > /dev/null 2>&1

        result=$?
        if [ $result -eq 0 ] ; then
            if [ $# -gt 0 ] ; then
                exec "$@"
            fi
            exit 0
        fi
        sleep 1
    done
    echo "Operation timed out" >&2
    exit 1
}

while [ $# -gt 0 ]
do
    case "$1" in
        *:* )
        HOST=$(printf "%s\n" "$1"| cut -d : -f 1)
        PORT=$(printf "%s\n" "$1"| cut -d : -f 2)
        shift 1
        ;;
        *)
        echoerr "Unknown argument: $1"
        usage 1
        ;;
    esac
done

wait_for cd /app && ./start-app.sh
