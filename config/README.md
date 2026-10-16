# Catálogos e configuração

`currencies.json` contém as moedas oferecidas pela aplicação. `airlines.json` reúne nomes, códigos IATA e aliases de companhias; origem e revisão estão em `airlines-source.json`, e a licença em `licenses/airlines-UNLICENSE.txt`. Os aliases de exibição podem diferir dos nomes originais. O catálogo não comprova operação ou disponibilidade de voos.

O manifesto local `google-oauth-public.json` é gerado pelo assistente e ignorado pelo Git/Docker. Ele não contém tokens nem substitui as credenciais privadas. Produção usa configuração OAuth Web no painel administrativo. Consulte [e-mail Google](../docs/GOOGLE_MAIL.md).

Não salve segredos ou JSON originais de credenciais nesta pasta.
