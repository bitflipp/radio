all: run

run:
	go run .

clean:
	rm -rf dist

dist: clean
	mkdir dist
	go build -o dist/radiogogo

deploy: dist
	rsync -av dist/ root@phinau.de:/home/radiogogo
	ssh root@phinau.de "chown -R radiogogo: /home/radiogogo"
	ssh root@phinau.de "systemctl restart radiogogo"
