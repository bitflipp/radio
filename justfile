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
	scp -O dist/radio deploy@phinau.de:/tmp
	ssh -t deploy@phinau.de "sudo systemctl stop radio && sudo mv /tmp/radio /home/radio && sudo chown -R radio: /home/radio && sudo systemctl start radio"

cbr *args:
	go run ./cmd/cbr {{args}}

migrate-chapters *args:
	go run ./cmd/migrate-chapters {{args}}
