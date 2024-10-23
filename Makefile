all: run

run:
	go run .

clean:
	rm -rf dist

dist: clean
	mkdir dist
	go build -o dist/radio

deploy: dist
	rsync -av dist/ root@phinau.de:/home/radio
	ssh root@phinau.de "chown -R radio: /home/radio"
	ssh root@phinau.de "systemctl restart radio"
