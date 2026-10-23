#!/bin/sh
set -e

create_fifo_queue() {
  awslocal sqs create-queue --queue-name "$1" \
    --attributes "FifoQueue=true,ContentBasedDeduplication=false${2:+,$2}" >/dev/null
}

create_fifo_queue wager-transactions-dlq.fifo

DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/wager-transactions-dlq.fifo \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

awslocal sqs create-queue --queue-name wager-transactions.fifo \
  --attributes "{\"FifoQueue\":\"true\",\"ContentBasedDeduplication\":\"false\",\"VisibilityTimeout\":\"30\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}" >/dev/null

create_fifo_queue wagering-events.fifo
