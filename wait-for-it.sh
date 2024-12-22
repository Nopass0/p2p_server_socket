#!/bin/bash

TIMEOUT=60
QUIET=0

nc -zv postgres 5432 && cd /app && ./start-app.sh
