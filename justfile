dev:
    npm run dev
up:
    dagger -c "build | as-service | up --ports=4321:80" -qq
