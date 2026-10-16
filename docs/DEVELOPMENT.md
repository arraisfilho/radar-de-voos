# Desenvolvimento

## Sem containers

Requisitos: Python 3.12 e Node.js 22.12 ou superior na linha 22.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm --prefix frontend ci
npm --prefix frontend run build
.venv/bin/python scripts/run.py
```

Acesse `http://localhost:8765`. A configuração inicial do administrador pelo navegador está disponível apenas no acesso local. Para desenvolver a interface com atualização automática, mantenha a API em execução e use `npm --prefix frontend run dev`; o Vite encaminha `/api` ao backend.

## Docker local

```sh
docker compose build &&
docker compose run --rm app python scripts/create_admin.py &&
docker compose up -d --wait
```

Acesse `http://localhost:8765`. Pare uma aplicação já em execução antes do assistente administrativo. Se a porta estiver ocupada, defina `RADAR_LOCAL_PORT` em todos os comandos Compose. O volume local é separado da implantação pública.

## Configuração

`.env.example` documenta as variáveis; o script local não carrega `.env` automaticamente. Exporte as variáveis no shell ou configure seu gerenciador de processos.

| Variável | Uso |
|---|---|
| `RADAR_DATA_DIR` | Diretório privado; padrão `.data/` |
| `RADAR_HOST`, `RADAR_PORT` | Interface e porta do processo local |
| `RADAR_LAN_CIDR` | Sub-rede privada autorizada para teste em outros dispositivos |
| `RADAR_PUBLIC_URL` | Origem canônica dos links de recuperação |
| `RADAR_RAW_RETENTION_DAYS` | Retenção de respostas brutas; padrão 30 dias |
| `RADAR_AUDIT_RETENTION_DAYS` | Retenção inicial de acessos; padrão 90 dias |
| `RADAR_DELIVERY_RETENTION_DAYS` | Retenção inicial de envios concluídos; padrão 90 dias |
| `RADAR_WHATSAPP_URL` | Sugestão inicial de URL do integrador |

Para testes na LAN, habilite escuta em todas as interfaces, configure `RADAR_LAN_CIDR` com sua sub-rede privada e ajuste `RADAR_PUBLIC_URL` para o endereço alcançável do servidor. Esse modo é destinado a redes confiáveis. Para publicar, use o [modo de produção](DEPLOYMENT.md).

Não execute dois processos sobre o mesmo diretório de dados. A configuração padrão de desenvolvimento pode criar um monitoramento inicial; use `RADAR_NO_SEED=1` para desativá-lo.

## Testes

```sh
.venv/bin/python -m unittest discover -s tests -v
npm --prefix frontend run build
for test in tests/frontend_*.cjs; do node "$test" || exit 1; done
```

Os testes usam dados temporários e transportes simulados. Consulte [validação](VALIDATION.md) para cobertura e verificações operacionais.
