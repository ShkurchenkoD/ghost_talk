FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /ghosttalk-server ./cmd/server

FROM alpine:3.20
WORKDIR /app
COPY --from=builder /ghosttalk-server /usr/local/bin/ghosttalk-server
EXPOSE 8080
CMD ["ghosttalk-server"]
