default: run

run:
	go run .

clean:
	rm -rf dist

dist: clean
	mkdir dist
	go build -o dist/radio

update:
	go get -u ./...
	go mod tidy

cbr *args:
	go run ./cmd/cbr {{args}}

migrate-chapters *args:
	go run ./cmd/migrate-chapters {{args}}
