default: run

run:
	go run .

clean:
	rm -rf dist

download:
	mkdir -p media
	rsync -av radio@phinau.de:/home/radio/media/ media

dist: clean
	mkdir dist
	go build -o dist/radio

update:
	go get -u ./...
	go mod tidy

deploy: dist
	rsync -av dist/ radio@phinau.de:/home/radio
