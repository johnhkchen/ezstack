install:
    npm run install

dev:
    npm run dev

up:
    dagger -c "build | as-service | up --ports=4321:4321" -qq
