// Media Hub — conteúdo da Ajuda em português (pt-BR).
//
// Espelha src/lib/helpContent.ts: os `id` das entradas e das categorias
// são IDÊNTICOS aos do inglês, para que os deep-links do (?) e a
// navegação por categoria continuem funcionando em qualquer idioma.
// Ao adicionar um tópico no inglês, adicione aqui com o MESMO id.
//
// Tradução pensada para editores de vídeo brasileiros: termos técnicos
// que o mercado usa em inglês (ProRes, DNxHR, proxy, timeline, B-roll)
// ficam em inglês de propósito — traduzi-los atrapalharia a busca.

import type { HelpCategory, HelpContent, HelpEntry } from "./helpContent";

const CATEGORIES_PT: HelpCategory[] = [
  { id: "getting-started", title: "Primeiros passos" },
  { id: "core-ideas", title: "Conceitos", blurb: "Os poucos conceitos que valem uma lida." },
  { id: "top-bar", title: "Barra superior" },
  { id: "download", title: "Página Baixar" },
  { id: "scrubber", title: "Prévia / Scrubber" },
  { id: "library", title: "Página Biblioteca" },
  { id: "projects", title: "Página Projetos" },
  { id: "settings", title: "Configurações" },
  { id: "extension", title: "Extensão do navegador" },
  { id: "troubleshooting", title: "Resolução de problemas" },
  {
    id: "developers",
    title: "Para desenvolvedores",
    blurb: "O Media Hub é código aberto — compile, modifique ou abra um bom report.",
  },
];

const ENTRIES_PT: HelpEntry[] = [
  // ---------------------------------------------------------------- primeiros passos
  {
    id: "quick-start",
    category: "getting-started",
    title: "Começo rápido (a versão de 30 segundos)",
    keywords: ["começar", "primeira vez", "como baixar", "básico", "início", "tutorial"],
    body: [
      "1. Vá em Baixar (menu da esquerda, ou tecle 1).",
      "2. Cole a URL de um vídeo (YouTube, Twitter/X, Pinterest etc.) e clique em Buscar.",
      "3. Escolha um formato (ou deixe o Melhor) e clique em Baixar.",
      "4. O clipe cai na sua Biblioteca (tecle 2) com miniatura, pronto pra arrastar pro seu editor.",
      "É esse o ciclo inteiro. Todo o resto deste manual é detalhe pra quando você precisar.",
    ],
  },
  {
    id: "shortcuts",
    category: "getting-started",
    title: "Atalhos de teclado",
    keywords: ["atalhos", "teclas", "teclado", "hotkeys"],
    body: [
      "1 / 2 / 3 — ir para Baixar / Biblioteca / Projetos.",
      ", (vírgula) — abrir Configurações.",
      "Ctrl+Space — abrir a busca / paleta de comandos.",
      "Espaço — play/pause no Scrubber.",
      "← / → — voltar / avançar um quadro.",
      "I / O — marcar entrada (In) / saída (Out).",
      "Ctrl (segurando) ao clicar em Baixar — manda aquele clipe pra Biblioteca.",
      "Delete — move o clipe selecionado pra Lixeira.",
      "Ctrl+C / Ctrl+X / Ctrl+V — copiar, recortar e colar clipes como arquivos.",
      "Esc — fecha o painel ou diálogo aberto / limpa a seleção.",
      "Atalhos de número e letra são ignorados enquanto você digita num campo de texto.",
    ],
  },

  // ---------------------------------------------------------------- conceitos
  {
    id: "idea-library-vs-projects",
    category: "core-ideas",
    title: "Biblioteca x Projetos",
    keywords: [
      "o que é projeto", "diferença", "escopo", "onde vão os clipes", "ativo", "biblioteca",
    ],
    body: [
      "No Media Hub um clipe pode viver em dois lugares, definidos pelo seletor Ativo na barra superior.",
      "Biblioteca — sua prateleira permanente e reutilizável. B-roll que você vai pegar de novo e de novo. O que está aqui fica pra sempre até você excluir.",
      "Um Projeto — um balde temporário para um trabalho só (ex.: \"BrandSpot 001\"). Baixe dentro do projeto enquanto trabalha; ao terminar, use Finalizar projeto para limpar os arquivos e manter o disco em ordem.",
      "O seletor Ativo decide para onde vão os novos downloads e o que a Biblioteca mostra. Voltar para a Biblioteca é sempre um clique.",
    ],
  },
  {
    id: "idea-trash",
    category: "core-ideas",
    title: "A Lixeira (excluir e recuperar clipes)",
    keywords: ["excluir", "recuperar", "desfazer exclusão", "lixeira", "clipe removido", "restaurar"],
    body: [
      "Excluir um clipe da Biblioteca move ele primeiro para uma Lixeira interna do app — ele ainda não foi embora e dá pra restaurar.",
      "Esvaziar a Lixeira, ou escolher \"excluir de vez\", manda os arquivos para a Lixeira do sistema operacional.",
      "Ou seja: são duas redes de segurança antes de algo se perder de verdade.",
    ],
  },
  {
    id: "idea-cookies",
    category: "core-ideas",
    title: "Cookies e por que alguns sites pedem login",
    keywords: [
      "login", "entrar", "vídeo privado", "restrição de idade", "só para membros",
      "cookies.txt", "verificação de robô", "vídeo indisponível", "autenticação",
    ],
    body: [
      "Alguns vídeos só baixam se o site achar que você está logado — restritos por idade, só para membros, bloqueados por região, ou atrás de um \"confirme que você não é um robô\".",
      "Cookies são como o navegador prova que você está conectado. Em Configurações → Fontes você aponta o Media Hub para os cookies do seu navegador, aí ele busca esses vídeos como você.",
      "Você só precisa disso se algum download falhar pedindo login.",
    ],
  },
  {
    id: "idea-presets",
    category: "core-ideas",
    title: "Presets de transcode explicados",
    keywords: [
      "converter", "prores", "dnxhd", "h264", "formato", "codec",
      "formato de edição", "proxy", "por que transcodar", "mezzanine",
    ],
    body: [
      "Vídeo baixado costuma vir comprimido (H.264 / VP9 / AV1) — ótimo pra armazenar, ruim pra arrastar numa timeline. Transcodar reempacota em um formato amigável à edição.",
      "ProRes (Apple) / DNxHD (Avid) — formatos \"mezzanine\" que os editores amam; arquivos grandes, edição lisa. Melhores para Premiere / Resolve / FCP.",
      "H.264 — continua pequeno; bom para assistir, menos ideal como fonte de edição.",
      "Copiar / Remux — só troca o contêiner, sem perda de qualidade, e é instantâneo.",
      "Você define um padrão em Configurações → Transcode, ou transcoda um clipe na hora pela Biblioteca.",
    ],
  },
  {
    id: "idea-preview",
    category: "core-ideas",
    title: "Qualidade da prévia e o scrubber",
    keywords: [
      "prévia", "preview", "scrub", "prévia lenta", "travando", "qualidade",
      "quadro exato", "jog",
    ],
    body: [
      "Antes de baixar, o Scrubber deixa você assistir ao vídeo e marcar pontos exatos de entrada e saída.",
      "Para ficar fluido ele baixa uma cópia \"proxy\" pequena em segundo plano. A Qualidade da prévia (nas Configurações) troca nitidez por velocidade — qualidade menor significa prévia mais rápida e leve.",
      "Isso nunca afeta a qualidade do que você realmente baixa; muda só a prévia.",
    ],
  },
  {
    id: "idea-background",
    category: "core-ideas",
    title: "Segundo plano e a bandeja",
    keywords: [
      "minimizar", "segundo plano", "bandeja", "continuar baixando", "fechar", "esconder janela",
    ],
    body: [
      "O Media Hub pode se esconder na bandeja do sistema e continuar baixando enquanto você trabalha em outros apps.",
      "Use o ícone de olho na barra superior para mandá-lo pra bandeja; clique no ícone da bandeja para trazer a janela de volta.",
    ],
  },

  // ---------------------------------------------------------------- barra superior
  {
    id: "topbar-active",
    category: "top-bar",
    title: "Seletor de projeto ativo",
    keywords: ["ativo", "escopo", "trocar projeto", "onde vão os clipes", "biblioteca"],
    body: [
      "O seletor que mostra \"Ativo: Biblioteca\" (ou o nome de um projeto). Define para onde vão os novos downloads e o que a Biblioteca exibe.",
      "Escolha Biblioteca para acervo permanente, um projeto para um trabalho específico, ou \"Novo projeto…\" para criar um.",
    ],
  },
  {
    id: "topbar-activity",
    category: "top-bar",
    title: "Indicador de atividade",
    keywords: ["indicador", "downloads ativos", "progresso", "quantos", "transcodando"],
    body: [
      "Só aparece enquanto há trabalho rodando. Mostra quantos estão ativos e se são downloads ou transcodes; clique para ir à página Baixar e acompanhar.",
    ],
  },
  {
    id: "topbar-search",
    category: "top-bar",
    title: "Buscar clipes",
    keywords: ["buscar", "achar clipe", "paleta de comandos", "procurar"],
    shortcut: "Ctrl+Space",
    body: [
      "Abre a paleta de comandos — uma busca rápida nos seus clipes. Digite parte do título ou do canal para ir direto nele.",
    ],
  },
  {
    id: "topbar-background",
    category: "top-bar",
    title: "Rodar em segundo plano (ícone de olho)",
    keywords: ["segundo plano", "bandeja", "minimizar", "continuar baixando", "esconder", "olho"],
    body: [
      "Esconde a janela na bandeja do sistema enquanto os downloads continuam.",
      "Passe o mouse no ícone da bandeja para ver quantos downloads estão ativos; clique para trazer a janela de volta. Na primeira vez aparece um aviso único pra você saber para onde o app foi.",
    ],
  },
  {
    id: "topbar-settings",
    category: "top-bar",
    title: "Configurações",
    keywords: ["configurações", "preferências", "opções", "ajustes"],
    shortcut: ",",
    body: ["Abre a página de Configurações (também no menu da esquerda)."],
  },

  // ---------------------------------------------------------------- página baixar
  {
    id: "dl-fetch",
    category: "download",
    title: "Campo de URL + Buscar",
    keywords: ["colar url", "buscar", "carregar vídeo", "informações", "metadados"],
    body: [
      "Cole a URL de um vídeo / playlist / canal e clique em Buscar (ou tecle Enter).",
      "O Media Hub lê as informações do vídeo — título, duração, formatos disponíveis, capítulos — para você escolher antes de se comprometer. Nada é baixado ainda.",
    ],
  },
  {
    id: "dl-fetch-playlist",
    category: "download",
    title: "Buscar playlist",
    keywords: ["playlist", "vários vídeos", "lote", "lista inteira"],
    body: [
      "Aparece quando a URL é uma playlist. Carrega todos os itens para você escolher quais enfileirar.",
    ],
  },
  {
    id: "dl-mode",
    category: "download",
    title: "Abas Vídeo / Áudio",
    keywords: ["só áudio", "mp3", "extrair áudio", "música", "vídeo ou áudio", "podcast"],
    body: [
      "Alterna entre baixar o vídeo completo ou apenas o áudio (para música, podcasts, camas sonoras). As opções de formato abaixo mudam junto.",
    ],
  },
  {
    id: "dl-formats",
    category: "download",
    title: "Mostrar / Ocultar lista de formatos",
    keywords: ["formato", "resolução", "qualidade", "1080p", "4k", "codec", "bitrate", "qual formato"],
    body: [
      "Expande a lista completa de todas as resoluções e codecs que a fonte oferece, cada linha com resolução, codec e tamanho.",
      "Escolha um para controle preciso, ou deixe o padrão Melhor e deixe o Media Hub pegar a opção de maior qualidade.",
    ],
  },
  {
    id: "dl-manual",
    category: "download",
    title: "Modo de formato manual",
    keywords: ["avançado", "formato personalizado", "código de formato", "especialista", "yt-dlp"],
    body: [
      "Permite digitar um seletor de formato bruto em vez de escolher na lista. Para usuários avançados que conhecem a sintaxe do yt-dlp; a maioria nunca precisa disso.",
    ],
  },
  {
    id: "dl-download",
    category: "download",
    title: "Baixar",
    keywords: ["botão baixar", "iniciar download", "salvar", "começar"],
    tip: "Segure Ctrl ao clicar em Baixar para mandar esse clipe pra Biblioteca mesmo com um projeto ativo. O botão acende pra confirmar.",
    body: [
      "A ação principal. Manda o clipe — com exatamente o formato, os trechos e o transcode que você escolheu — para o escopo Ativo (Biblioteca ou projeto).",
      "O download vai para a fila logo abaixo, e o card de busca libera na hora. Você não precisa esperar: cole a próxima URL e siga em frente enquanto a fila trabalha (vários rodam em paralelo).",
      "Acompanhe o progresso na linha da fila; o clipe chega na Biblioteca quando terminar.",
    ],
  },
  {
    id: "dl-cancel",
    category: "download",
    title: "Cancelar / Parar download",
    keywords: ["cancelar", "parar", "abortar", "interromper", "arquivo parcial"],
    body: [
      "Interrompe o download. Os arquivos parciais que ele deixou (.part, .ytdl e os fluxos antes da junção) são limpos automaticamente, então nada pela metade se acumula na sua pasta.",
      "Só as sobras daquele download são removidas — outros downloads rodando em paralelo, e qualquer cópia completa do mesmo vídeo que você já tinha, ficam intactos.",
    ],
  },
  {
    id: "dl-open",
    category: "download",
    title: "Abrir (pasta)",
    keywords: ["abrir pasta", "mostrar", "achar arquivo", "explorer", "localizar"],
    body: [
      "Depois que um download termina, mostra o arquivo salvo no seu gerenciador de arquivos (Explorer / Finder).",
    ],
  },
  {
    id: "dl-playlist-select",
    category: "download",
    title: "Seleção da playlist",
    keywords: ["selecionar tudo", "limpar seleção", "primeiros 5", "primeiros 10", "escolher vídeos"],
    body: [
      "Com uma playlist carregada você tem Selecionar tudo, Limpar seleção e atalhos de primeiros 5 / primeiros 10, além do botão para enfileirar os escolhidos. Tudo que estiver selecionado entra na fila de download.",
    ],
  },
  {
    id: "dl-queue",
    category: "download",
    title: "Fila de download",
    keywords: ["fila", "lote", "vários downloads", "colar lista", "em massa"],
    body: [
      "Cole várias URLs (uma por linha) e clique em Baixar tudo. Vários downloads rodam em paralelo; os transcodes entram em fila, mas os pools de CPU e GPU são independentes (um job libx264 e um NVENC podem rodar juntos).",
      "A fila também recebe os downloads disparados pelo card de busca e os transcodes pedidos pela Biblioteca. Ela sobrevive a reinícios do app.",
      "Limpar concluídos tira as linhas finalizadas da lista. Tentar novamente refaz as que deram erro (só aparece quando algo falhou).",
    ],
  },
  {
    id: "dl-duplicate",
    category: "download",
    title: "Aviso de duplicado / Abrir existente",
    keywords: ["já baixado", "duplicado", "mesmo vídeo", "existe"],
    body: [
      "Se você já tem exatamente esse vídeo, o Media Hub avisa em vez de baixar duas vezes e oferece mostrar o arquivo existente.",
    ],
  },

  // ---------------------------------------------------------------- scrubber
  {
    id: "scrub-play",
    category: "scrubber",
    title: "Play / pause",
    keywords: ["play", "pause", "assistir", "tocar"],
    shortcut: "Espaço",
    body: ["Clique no vídeo ou tecle Espaço para dar play/pause na prévia."],
  },
  {
    id: "scrub-step",
    category: "scrubber",
    title: "Voltar / avançar um quadro",
    keywords: ["quadro", "frame", "quadro anterior", "próximo quadro", "preciso", "setas"],
    shortcut: "← / →",
    body: [
      "Os botões de seta (e as teclas) movem exatamente um quadro por vez — para achar o ponto de corte exato.",
      "São ferramentas de precisão, então as otimizações de prévia rápida saem da frente delas.",
    ],
  },
  {
    id: "scrub-jog",
    category: "scrubber",
    title: "Scrub fino (jog)",
    keywords: ["jog", "scrub fino", "scrub lento", "davinci", "arrastar", "busca precisa"],
    body: [
      "Uma régua de jog no estilo DaVinci: arraste para percorrer devagar (cerca de 1 segundo a cada 80 pixels) e caçar quadros sem passar do ponto.",
    ],
  },
  {
    id: "scrub-volume",
    category: "scrubber",
    title: "Volume",
    keywords: ["volume", "mudo", "som", "nível de áudio"],
    body: ["Ajusta apenas o volume da prévia."],
  },
  {
    id: "scrub-in",
    category: "scrubber",
    title: "Marcar entrada (In)",
    keywords: ["marcar in", "ponto de entrada", "início", "cortar início"],
    shortcut: "I",
    body: ["Define o início de um trecho na posição atual."],
  },
  {
    id: "scrub-out",
    category: "scrubber",
    title: "Marcar saída (Out)",
    keywords: ["marcar out", "ponto de saída", "fim", "cortar fim", "confirmar trecho"],
    shortcut: "O",
    body: [
      "Define o fim e confirma o trecho. Você pode marcar vários trechos e baixar todos de uma vez.",
    ],
  },
  {
    id: "scrub-clear",
    category: "scrubber",
    title: "Limpar trechos",
    keywords: ["limpar", "resetar", "remover todos os trechos", "recomeçar"],
    body: ["Remove todos os trechos marcados e qualquer rascunho em andamento."],
  },
  {
    id: "scrub-chapters",
    category: "scrubber",
    title: "Capítulos: pular e adicionar",
    keywords: ["capítulos", "marcadores", "seções", "pular capítulo", "capítulos do youtube"],
    body: [
      "Se a fonte tiver capítulos, eles aparecem como marcadores. Clique num capítulo para pular até ele, ou use o + dele para adicionar aquele capítulo como trecho na hora — ótimo para pegar uma seção específica de um vídeo longo.",
    ],
  },
  {
    id: "scrub-segments",
    category: "scrubber",
    title: "Lista de trechos",
    keywords: ["trechos", "segmentos", "lista de clipes", "remover trecho"],
    body: [
      "Cada trecho confirmado aparece numa lista. Clique num deles para ir ao seu início, ou use o ✕ para remover só aquele.",
    ],
  },

  // ---------------------------------------------------------------- biblioteca
  {
    id: "lib-view",
    category: "library",
    title: "Modo Grade / Lista",
    keywords: ["grade", "lista", "modo de visualização", "miniaturas", "tabela", "layout"],
    body: [
      "Alterna entre uma grade de miniaturas grandes e uma lista compacta (com colunas redimensionáveis; duplo clique num divisor restaura).",
    ],
  },
  {
    id: "lib-search",
    category: "library",
    title: "Campo de busca",
    keywords: ["buscar", "achar", "filtrar por nome", "título", "canal"],
    body: ["Filtra a visão atual por título ou canal conforme você digita."],
  },
  {
    id: "lib-filter-source",
    category: "library",
    title: "Filtro de origem / data",
    keywords: ["filtro", "origem", "site", "data de adição", "quando", "só youtube"],
    body: [
      "Restringe os clipes por onde vieram (YouTube, Twitter etc.) e por quando foram adicionados.",
    ],
  },
  {
    id: "lib-filter-tags",
    category: "library",
    title: "Filtro de tags",
    keywords: ["tags", "filtrar tags", "etiquetas", "categorias"],
    body: ["Mostra apenas os clipes que têm as tags que você escolher."],
  },
  {
    id: "lib-clear-filters",
    category: "library",
    title: "Limpar filtros",
    keywords: ["limpar filtros", "resetar", "mostrar tudo", "remover filtros"],
    body: ["Descarta todos os filtros ativos e volta a mostrar tudo do escopo."],
  },
  {
    id: "lib-folders",
    category: "library",
    title: "Barra lateral de pastas",
    keywords: ["pastas", "organizar", "aninhar", "mover", "arrastar", "coleções"],
    body: [
      "Suas pastas personalizadas. Uma pasta faz bastante coisa num lugar só:",
      "Clique — filtra por ela. Duplo clique — renomeia. Clique direito — mais ações (cor, excluir…).",
      "Arraste uma pasta sobre outra para aninhar. Solte clipes numa pasta para movê-los pra dentro dela.",
    ],
  },
  {
    id: "lib-folder-new",
    category: "library",
    title: "Criar pasta",
    keywords: ["nova pasta", "adicionar pasta", "criar", "mais"],
    body: ["O + na barra lateral de pastas cria uma pasta nova."],
  },
  {
    id: "lib-unfiled",
    category: "library",
    title: "Sem categoria",
    keywords: ["sem categoria", "sem pasta", "não categorizado", "clipes soltos"],
    body: ["Clipes que não estão em nenhuma pasta. Solte um clipe aqui para tirá-lo da pasta dele."],
  },
  {
    id: "lib-rollup",
    category: "library",
    title: "Incluir subpastas",
    keywords: ["subpastas", "incluir filhas", "aninhadas", "conteúdo das subpastas"],
    body: ["Ao ver uma pasta, alterna se os clipes das subpastas dela também aparecem."],
  },
  {
    id: "lib-trash",
    category: "library",
    title: "Lixeira",
    keywords: [
      "lixeira", "excluídos", "recuperar", "restaurar", "excluir de vez", "esvaziar lixeira",
    ],
    tip: "Clique direito na Lixeira da barra lateral para Restaurar tudo / Esvaziar lixeira sem precisar abrir a visão.",
    body: [
      "Guarda os clipes excluídos. Restaurar devolve o clipe para onde ele estava.",
      "Excluir de vez remove para sempre — os arquivos vão para a Lixeira do sistema operacional, e isso não dá para desfazer.",
      "Dentro da Lixeira, Restaurar e Esvaziar agem sobre a sua seleção, ou sobre tudo quando nada está selecionado.",
    ],
  },
  {
    id: "lib-card",
    category: "library",
    title: "Card do clipe",
    keywords: ["clipe", "card", "miniatura", "abrir clipe"],
    body: [
      "Cada clipe. Um clique seleciona (abre o inspetor); duplo clique (ou a ação abrir) toca no seu app padrão.",
      "Um clipe só de áudio mostra uma forma de onda; um clipe cujo arquivo foi movido ou excluído mostra o selo de \"não encontrado\".",
    ],
  },
  {
    id: "lib-card-open",
    category: "library",
    title: "Card: Abrir",
    keywords: ["abrir", "tocar", "app padrão", "assistir"],
    body: ["Abre o clipe no player padrão do seu sistema."],
  },
  {
    id: "lib-card-reveal",
    category: "library",
    title: "Card: Mostrar no gerenciador de arquivos",
    keywords: ["mostrar", "explorer", "finder", "localizar arquivo", "pasta"],
    body: ["Abre a pasta que contém o arquivo e destaca ele."],
  },
  {
    id: "lib-card-delete",
    category: "library",
    title: "Card: Mover para a Lixeira",
    keywords: ["excluir", "remover", "lixeira", "apagar"],
    shortcut: "Delete",
    body: ["Manda o clipe para a Lixeira (recuperável) e, depois, para a Lixeira do sistema."],
  },
  {
    id: "lib-rtx",
    category: "library",
    title: "Melhorar com NVIDIA RTX Video",
    keywords: [
      "rtx", "upscale", "melhorar", "super resolution", "vsr", "nvidia",
      "qualidade", "restaurar", "4k", "aumentar resolução", "melhorar vídeo",
    ],
    tip: "Funciona melhor em material comprimido da web (um rip 720p do YouTube). Ele reconstrói o detalhe que a compressão destruiu — não inventa detalhe que nunca foi filmado.",
    body: [
      "Clique direito num clipe → Melhorar (NVIDIA RTX Video). Roda o Video Super Resolution da NVIDIA na sua GPU: limpa artefatos de compressão e reconstrói bordas enquanto aumenta a resolução, sem o aspecto plástico da maioria dos upscalers de IA.",
      "O clipe melhorado é salvo ao lado do original como um irmão — seu arquivo de origem nunca é modificado.",
      "Configurar na janela RTX… abre uma janela de revisão, onde você pode pré-visualizar um trecho, comparar antes/depois e ajustar a limpeza antes de renderizar tudo.",
      "Precisa de uma GPU NVIDIA compatível; em máquinas que não rodam, a opção nem aparece no menu.",
    ],
  },
  {
    id: "lib-transcode",
    category: "library",
    title: "Transcodar um clipe que você já tem",
    keywords: [
      "transcodar", "converter", "prores", "dnxhr", "h264", "nvenc",
      "formato de edição", "premiere", "resolve", "after effects",
    ],
    body: [
      "Clique direito num clipe → Transcodar para… e escolha um preset (ProRes 422 LT, DNxHR SQ, H.264 ou H.264 NVENC).",
      "Útil quando você baixou algo como estava e só depois descobriu que seu editor não roda liso — sem precisar baixar de novo.",
      "Roda como um job na fila da página Baixar. Ao terminar, o arquivo transcodado fica na Biblioteca e o original vai para a Lixeira, então você fica com um clipe, não dois. O original continua recuperável na Lixeira se quiser de volta.",
    ],
  },
  {
    id: "lib-import",
    category: "library",
    title: "Adicionar seus próprios arquivos (arrastar e soltar)",
    keywords: [
      "importar", "arrastar", "soltar", "adicionar arquivo", "material próprio",
      "arquivo local", "externo", "vídeo existente", "trazer pra dentro",
    ],
    tip: "Clipes importados são de primeira classe — dá pra dar upscale, transcodar, taguear e organizar igual aos baixados.",
    body: [
      "Arraste arquivos de vídeo ou áudio do Explorer para a grade da Biblioteca. Um contorno tracejado confirma onde soltar.",
      "Os arquivos são COPIADOS para a pasta da biblioteca do Media Hub, depois lidos para extrair duração, resolução e codec, e ganham miniatura. Como é cópia, mover ou excluir o original depois não quebra o card.",
      "Vários arquivos de uma vez funciona normalmente. Qualquer coisa que não seja vídeo ou áudio é ignorada.",
      "Você também pode colar arquivos com Ctrl+V — copie no Explorer e cole na Biblioteca.",
    ],
  },
  {
    id: "lib-clipboard",
    category: "library",
    title: "Copiar, recortar e colar clipes como arquivos",
    keywords: [
      "copiar", "recortar", "colar", "ctrl+c", "ctrl+x", "ctrl+v", "área de transferência",
      "explorer", "mover arquivo", "exportar",
    ],
    shortcut: "Ctrl+C / Ctrl+X / Ctrl+V",
    body: [
      "Selecione clipes e tecle Ctrl+C — os arquivos de verdade vão para a área de transferência do Windows, então você cola direto em qualquer pasta do Explorer, no bin de mídia do seu editor, ou numa conversa.",
      "Ctrl+X marca para MOVER. Depois de colar em outro lugar o arquivo sai fisicamente da pasta da biblioteca, então o card fica marcado como ausente — isso é esperado, e você limpa com Remover ausentes.",
      "Ctrl+V faz o contrário: arquivos copiados no Explorer são importados para a Biblioteca.",
    ],
  },
  {
    id: "lib-inspector",
    category: "library",
    title: "Painel do inspetor",
    keywords: ["detalhes", "informações", "inspetor", "metadados", "editar clipe"],
    body: [
      "O painel da direita para o clipe selecionado — miniatura, metadados (duração, dimensões, contêiner, tamanho, codec, data de adição), tags, URL de origem e as ações rápidas (abrir, mostrar na pasta, enviar pro Eagle, mover pra Lixeira).",
      "Selecione vários clipes e ele vira uma visão de lote: tamanho total, origens, um editor de tags compartilhado e a lista do que está selecionado.",
      "Ações que valem para muitos clipes de uma vez — excluir, transcodar, enviar pro Eagle — ficam no menu de clique direito, então agem na seleção inteira.",
      "Tecle Esc para limpar a seleção.",
    ],
  },
  {
    id: "lib-tags",
    category: "library",
    title: "Tags (adicionar / remover)",
    keywords: ["tags", "etiqueta", "categorizar", "adicionar tag", "remover tag", "palavra-chave"],
    body: [
      "Digite no campo de tag para adicionar uma (dá pra criar na hora), ou clique no ✕ de uma tag para removê-la. As tags alimentam o filtro de tags e a busca.",
    ],
  },
  {
    id: "lib-folder-color",
    category: "library",
    title: "Cor da pasta",
    keywords: ["cor", "cor da pasta", "sem cor", "etiqueta colorida"],
    body: ["Dê uma cor à pasta para bater o olho e achar rápido; \"Sem cor\" remove."],
  },
  {
    id: "lib-selection",
    category: "library",
    title: "Ações em seleção",
    keywords: ["selecionar vários", "lote", "multi-seleção", "ações em massa"],
    body: [
      "Selecione vários clipes para agir sobre eles juntos (taguear todos, excluir todos, transcodar). Ctrl+clique adiciona, Shift+clique pega um intervalo, e arrastar no vazio faz seleção em caixa.",
      "O inspetor mostra o resumo da seleção; as ações ficam no menu de clique direito. Esc limpa.",
    ],
  },

  // ---------------------------------------------------------------- projetos
  {
    id: "proj-list",
    category: "projects",
    title: "Lista de projetos",
    keywords: ["todos os projetos", "lista", "abrir projeto", "contagem de clipes"],
    body: ["Todos os projetos com a contagem de clipes. Clique num deles para abrir os detalhes."],
  },
  {
    id: "proj-new",
    category: "projects",
    title: "Novo projeto",
    keywords: ["novo projeto", "criar", "adicionar projeto", "nome"],
    body: [
      "Nomeie e crie um projeto (ex.: \"Reel de Drone\"). Novos downloads vão pra ele enquanto for o escopo Ativo.",
    ],
  },
  {
    id: "proj-finish",
    category: "projects",
    title: "Finalizar projeto",
    keywords: ["finalizar", "concluir", "limpar", "fechar projeto", "excluir arquivos"],
    body: [
      "Encerra um projeto: limpa os arquivos dele do seu disco para manter tudo em ordem. Use quando o trabalho já foi entregue.",
    ],
  },
  {
    id: "proj-return",
    category: "projects",
    title: "Devolver clipes para a Biblioteca",
    keywords: ["devolver", "mover para biblioteca", "manter clipes"],
    body: [
      "Move os clipes de um projeto de volta para a Biblioteca permanente em vez de removê-los — os arquivos ficam no disco. Bom para os que você vai reutilizar.",
    ],
  },

  // ---------------------------------------------------------------- configurações
  {
    id: "set-sources",
    category: "settings",
    title: "Fontes (cookies / login)",
    keywords: [
      "cookies", "login", "navegador", "entrar", "privado", "restrição de idade",
      "cookies.txt", "autenticação",
    ],
    body: [
      "Aponta o Media Hub para os cookies do seu navegador, para baixar vídeos que exigem estar logado (restritos por idade, só para membros etc.).",
      "Escolha um navegador de onde puxar os cookies, ou informe o caminho de um arquivo cookies.txt. Só é necessário quando um download pede login.",
    ],
  },
  {
    id: "set-library",
    category: "settings",
    title: "Biblioteca (pasta raiz + renomeação)",
    keywords: [
      "local de salvamento", "pasta", "onde ficam os arquivos", "raiz",
      "padrão de nome", "nome de arquivo", "caminho",
    ],
    body: [
      "Pasta raiz — a pasta base onde os arquivos baixados são guardados. Deixe em branco para o padrão (~/Media Hub).",
      "Padrão de nome — como os arquivos são nomeados, ex.: {title} [{id}].",
    ],
  },
  {
    id: "set-downloads",
    category: "settings",
    title: "Downloads (paralelos + limite)",
    keywords: [
      "velocidade", "simultâneos", "paralelo", "limite de velocidade",
      "downloads rápidos", "aria2",
    ],
    body: [
      "Downloads simultâneos — quantos rodam ao mesmo tempo.",
      "Limite de velocidade (KiB/s) — limita a banda para os downloads não engolirem sua conexão.",
      "Downloads rápidos (aria2) — baixador externo opcional para arquivos grandes ou segmentados; ele baixa o auxiliar na primeira vez que você ativa.",
    ],
  },
  {
    id: "set-transcode",
    category: "settings",
    title: "Transcode (preset padrão)",
    keywords: ["formato padrão", "prores", "dnxhd", "converter", "formato de edição", "preset"],
    body: ["Escolhe o preset aplicado por padrão quando você transcoda."],
  },
  {
    id: "set-bridge",
    category: "settings",
    title: "Ponte do navegador (extensão)",
    keywords: [
      "extensão", "ponte", "pareamento", "token", "enviar para o app", "conectar navegador",
    ],
    body: [
      "Conecta a extensão do Media Hub para você mandar vídeos do navegador direto pro app.",
      "Copiar URL — o endereço local ao qual a extensão se conecta. Copiar token — o segredo de pareamento.",
      "Gerar novo token cria um token novo e desconecta o antigo (use se achar que vazou).",
    ],
  },
  {
    id: "set-diagnostics",
    category: "settings",
    title: "Diagnóstico (logs + reparo)",
    keywords: [
      "logs", "depuração", "versões", "reparar", "quebrado", "ffmpeg faltando", "problema",
    ],
    body: [
      "Informações de saúde (somente leitura) e ferramentas de reparo.",
      "Reparar ferramentas rebaixa o ffmpeg + deno se estiverem faltando ou corrompidos. Tente isso primeiro se o transcode ou a prévia pararem de funcionar do nada.",
      "Abrir pasta de logs abre a pasta com o media-hub.log para reports de bug. A seção também mostra as versões instaladas de yt-dlp / ffmpeg / deno, e tem o botão de procurar atualizações do app.",
    ],
  },
  {
    id: "set-about",
    category: "settings",
    title: "Sobre",
    keywords: ["versão", "sobre", "atualização", "créditos", "licença"],
    body: ["Versão e informações do app. O Media Hub verifica atualizações e se atualiza sozinho."],
  },

  // ---------------------------------------------------------------- resolução de problemas
  {
    id: "trouble-login",
    category: "troubleshooting",
    title: "\"Faça login / não é um robô / vídeo indisponível\"",
    keywords: ["erro", "login", "robô", "indisponível", "não consigo baixar", "falha"],
    body: ["O site precisa que você esteja logado. Configure os cookies em Configurações → Fontes."],
  },
  {
    id: "trouble-transcode",
    category: "troubleshooting",
    title: "Transcode ou prévia parou de funcionar",
    keywords: ["transcode falhou", "prévia quebrada", "ffmpeg", "deno", "reparar"],
    body: [
      "O ffmpeg ou o deno podem estar faltando ou corrompidos. Rode Configurações → Diagnóstico → Reparar ferramentas.",
    ],
  },
  {
    id: "trouble-slow-preview",
    category: "troubleshooting",
    title: "A prévia demora para buscar",
    keywords: ["lento", "travando", "buscar", "qualidade da prévia", "carregando"],
    body: [
      "Baixe a Qualidade da prévia; a primeira busca também precisa baixar um proxy, então dê um tempinho num vídeo novo.",
    ],
  },
  {
    id: "trouble-slow-download",
    category: "troubleshooting",
    title: "O download está lento",
    keywords: ["download lento", "velocidade", "aria2", "rápido"],
    body: [
      "Ative Downloads rápidos (aria2) nas configurações de Downloads, especialmente para arquivos grandes ou segmentados.",
    ],
  },
  {
    id: "trouble-file-not-found",
    category: "troubleshooting",
    title: "Um clipe mostra \"arquivo não encontrado\"",
    keywords: ["arquivo não encontrado", "ausente", "movido", "excluído", "clipe quebrado"],
    body: [
      "O arquivo foi movido ou excluído fora do app. Baixe de novo, ou use Mostrar na pasta para ver onde ele foi parar.",
      "Se você recortou o clipe com Ctrl+X e colou em outro lugar, isso é esperado — use Remover ausentes para limpar o card.",
    ],
  },
  {
    id: "trouble-logs",
    category: "troubleshooting",
    title: "Onde ficam os logs?",
    keywords: ["logs", "arquivo de log", "media-hub.log", "report de bug"],
    body: ["Configurações → Diagnóstico → Abrir pasta de logs (media-hub.log)."],
  },
  {
    id: "trouble-deleted",
    category: "troubleshooting",
    title: "Excluí um clipe sem querer",
    keywords: ["sem querer", "recuperar", "restaurar", "desfazer exclusão", "lixeira"],
    body: [
      "Veja na Lixeira e clique em Restaurar — desde que você não tenha excluído de vez.",
    ],
  },

  // ---------------------------------------------------------------- extensão
  {
    id: "ext-what",
    category: "extension",
    title: "O que a extensão do navegador faz",
    keywords: [
      "extensão", "complemento", "navegador", "enviar para o app", "chrome", "firefox", "edge",
    ],
    body: [
      "O Media Hub tem uma extensão opcional que adiciona um botão \"Enviar para o Media Hub\" ao seu navegador. Clique nele num vídeo e ele cai direto na fila de download do app — sem copiar e colar URL.",
      "É totalmente opcional. Tudo funciona pelo app colando a URL; a extensão só economiza a viagem.",
    ],
  },
  {
    id: "ext-install",
    category: "extension",
    title: "Instalando a extensão",
    keywords: [
      "instalar extensão", "carregar sem compactação", "modo desenvolvedor",
      "chrome extensions", "adicionar",
    ],
    body: [
      "Chrome / Edge / Brave: abra chrome://extensions (ou edge://, brave://), ative o \"Modo do desenvolvedor\" (canto superior direito), clique em \"Carregar sem compactação\" e escolha a pasta `extension` do app.",
      "Firefox: abra about:debugging → \"Este Firefox\" → \"Carregar extensão temporária\" → escolha o `manifest.json` na pasta da extensão. (O Firefox esquece ao fechar o navegador.)",
      "Depois pareie com o app — veja \"Parear a extensão com o app\".",
    ],
  },
  {
    id: "ext-pair",
    category: "extension",
    title: "Parear a extensão com o app",
    keywords: [
      "parear", "token", "conectar extensão", "ponte", "testar conexão", "não alcança o app",
    ],
    body: [
      "A extensão conversa com o app pelo seu próprio computador (localhost), e um token impede que sites aleatórios façam o mesmo. Pareie uma vez:",
      "1. No app: Configurações → Ponte do navegador → Copiar token.",
      "2. No navegador: clique no ícone da extensão → Opções → cole o token → Salvar → Testar conexão.",
      "Uma mensagem verde de \"Conectado\" significa que está pronto. Se não alcançar o app, confira se o aplicativo está aberto.",
    ],
  },
  {
    id: "ext-use",
    category: "extension",
    title: "Formas de enviar um vídeo pelo navegador",
    keywords: [
      "enviar vídeo", "baixar do navegador", "atalho", "clique direito", "botão", "mp3",
    ],
    body: [
      "Botão da barra (funciona em qualquer lugar): clique no ícone da extensão, escolha Vídeo / MP3 / M4A / FLAC e clique em Enviar.",
      "Botão na página (YouTube, Twitter/X, Reddit, Pinterest, TikTok, Instagram): passe o mouse sobre um vídeo e clique no botãozinho verde \"Media Hub\".",
      "Clique direito num vídeo/link → Enviar para o Media Hub (alguns sites bloqueiam isso — use outro caminho neles).",
      "Teclado: Ctrl+Shift+Y manda a aba atual como vídeo, Ctrl+Shift+M como MP3. Funcionam até no YouTube.",
      "Se o Media Hub não estiver aberto na hora do envio, a extensão abre o app pra você e enfileira o vídeo assim que ele sobe.",
    ],
  },
  {
    id: "ext-quickmenu",
    category: "extension",
    title: "Escolher opções antes de enviar (menu rápido)",
    keywords: [
      "opções", "qualidade", "renomear", "transcode", "ctrl clique",
      "antes de baixar", "1080p", "720p", "áudio", "nomear arquivo",
    ],
    shortcut: "Ctrl+clique",
    tip: "Renomear nomeia o ARQUIVO no disco, não só o card — ótimo pra já cair na edição com o nome que seu projeto espera.",
    body: [
      "Ctrl+clique (Cmd+clique no Mac) no botão \"Media Hub\" da página abre um menu de opções em vez de enviar na hora.",
      "Dá pra definir o teto de qualidade (Melhor / 1080p / 720p / 480p), trocar para só áudio (MP3 / M4A / FLAC), digitar um nome de arquivo e escolher um preset de transcode — tudo antes do download começar.",
      "O clique normal continua enviando na hora com seus padrões salvos, então o caminho rápido não fica mais lento.",
    ],
  },
  {
    id: "ext-privacy",
    category: "extension",
    title: "A extensão é segura / privada?",
    keywords: ["segura", "privada", "privacidade", "segurança", "dados", "rastreamento", "localhost"],
    body: [
      "Sim. A extensão só conversa com o seu próprio computador (127.0.0.1) — nunca manda nada para a internet nem para nós.",
      "Ela só envia uma URL de vídeo quando você clica num botão; nunca baixa sozinha. O token de pareamento funciona como senha, então outros sites não conseguem disparar downloads no seu app.",
    ],
  },
  {
    id: "ext-trouble",
    category: "extension",
    title: "A extensão não conecta / o botão sumiu",
    keywords: [
      "extensão não funciona", "offline", "não conecta", "botão não aparece", "recarregar",
    ],
    body: [
      "\"Media Hub offline\" / não conecta → o aplicativo não está aberto. Abra e tente de novo.",
      "O botão na página não aparece → atualize a página (Ctrl+F5); ele só entra em páginas carregadas depois da extensão.",
      "Se aparecer \"Reload page (F5)\" → a extensão foi instalada ou atualizada com a aba já aberta; só recarregar a página resolve.",
      "Trocou o token no app → abra as Opções da extensão, cole o novo token e Salve.",
      "Editou os arquivos da extensão → recarregue em chrome://extensions (o ícone ↻ no card).",
    ],
  },

  // ---------------------------------------------------------------- resolução (extra)
  {
    id: "trouble-download-fails",
    category: "troubleshooting",
    title: "Um download falha ou dá erro",
    keywords: ["download falhou", "erro", "não baixa", "indisponível", "extrator"],
    body: [
      "A maioria das falhas de download é uma destas três coisas:",
      "1. O vídeo precisa de login → configure os cookies (Configurações → Fontes).",
      "2. O site mudou e o baixador está desatualizado → Configurações → Diagnóstico mostra a versão do yt-dlp; uma versão mais nova do app traz um yt-dlp mais novo.",
      "3. URL inválida ou bloqueada por região → tente abrir no navegador para confirmar que toca.",
      "Se ainda assim falhar, pegue o log (Diagnóstico → Abrir pasta de logs) e reporte — veja \"Como reportar um bug direito\".",
    ],
  },
  {
    id: "trouble-first-run",
    category: "troubleshooting",
    title: "Travou na configuração inicial / as ferramentas não baixam",
    keywords: [
      "primeira execução", "configuração", "ferramentas", "baixar ffmpeg", "deno", "travado",
    ],
    body: [
      "Na primeira abertura o app baixa suas ferramentas de mídia (ffmpeg + deno). Se isso empacar, quase sempre é rede (firewall/VPN bloqueando o GitHub).",
      "Tente de novo numa conexão normal, ou use Configurações → Diagnóstico → Reparar ferramentas para rebaixá-las. O app fica utilizável assim que elas terminam.",
    ],
  },
  {
    id: "trouble-app-wont-start",
    category: "troubleshooting",
    title: "O app não abre ou mostra uma janela em branco",
    keywords: ["não abre", "branco", "tela branca", "trava", "janela preta"],
    body: [
      "Feche completamente primeiro — confira a bandeja do sistema (ele pode estar rodando escondido, já que mantém os downloads vivos em segundo plano) e escolha Sair, depois abra de novo.",
      "Se a janela em branco continuar, reinstale por cima (sua biblioteca e configurações ficam guardadas à parte e não são tocadas). Ainda travado? Mande o log da pasta de logs.",
    ],
  },
  {
    id: "trouble-update",
    category: "troubleshooting",
    title: "Atualizando o Media Hub",
    keywords: [
      "atualizar", "atualização automática", "versão", "não atualiza", "versão antiga", "nova versão",
    ],
    body: [
      "Quando sai uma versão nova, um aviso discreto aparece no canto pouco depois de abrir o app — clique em Atualizar agora e ele baixa, verifica e se instala sozinho, depois reabre. O aviso aparece uma vez por versão, então nunca fica insistindo.",
      "Você também pode checar quando quiser: Configurações → Diagnóstico → Procurar atualizações.",
      "Se uma atualização parecer travada, confirme a versão em Configurações → Sobre, feche completamente (inclusive pela bandeja) e abra de novo para o instalador trocar os arquivos.",
      "Reinstalar a última versão por cima da atual é sempre seguro — configurações e biblioteca são preservadas.",
    ],
  },
  {
    id: "report-bug",
    category: "troubleshooting",
    title: "Como reportar um bug direito",
    keywords: ["reportar bug", "report", "problema", "feedback", "quebrado", "logs"],
    body: [
      "Um bom report é consertado rápido. Inclua:",
      "1. O que você fez, o que esperava e o que aconteceu.",
      "2. A URL exata (se for problema de download/busca) — muitos bugs são específicos de site.",
      "3. Sua versão do app (Configurações → Sobre) e o sistema (ex.: Windows 11).",
      "4. O arquivo de log — Configurações → Diagnóstico → Abrir pasta de logs → anexe o `media-hub.log`.",
      "5. Um print de qualquer mensagem de erro.",
      "Mande pelo canal que o projeto indicar (issues do GitHub / a thread do release). O log é a coisa mais útil de todas — normalmente ele mostra o erro real.",
    ],
  },

  // ---------------------------------------------------------------- desenvolvedores
  {
    id: "dev-open-source",
    category: "developers",
    title: "Com o que ele é feito",
    keywords: ["código aberto", "stack", "tecnologia", "tauri", "rust", "react", "typescript", "sqlite"],
    body: [
      "O Media Hub é um app desktop em Tauri 2: núcleo em Rust com frontend React + TypeScript (Vite), biblioteca em SQLite, e yt-dlp / ffmpeg / deno como binários auxiliares.",
      "A interface fala com o Rust por comandos do Tauri (invoke) e escuta eventos para progresso ao vivo. Veja docs/ARCHITECTURE.md no repositório para o quadro completo.",
    ],
  },
  {
    id: "dev-run-source",
    category: "developers",
    title: "Rodar a partir do código",
    keywords: [
      "ambiente de dev", "compilar do código", "rodar local", "npm", "cargo", "tauri dev",
    ],
    body: [
      "Você vai precisar de Node.js 20+, a toolchain estável do Rust (rustup) e as ferramentas de build de webview da sua plataforma (Windows: VS C++ Build Tools; macOS: Xcode CLT).",
      "Então: `npm install`, baixe os sidecars com `pwsh scripts/fetch-sidecars.ps1` (ou o .sh do mac) e `npm run tauri dev`. O primeiro build do Rust leva vários minutos; depois é incremental.",
    ],
  },
  {
    id: "dev-build",
    category: "developers",
    title: "Gerar um instalador",
    keywords: ["build", "instalador", "release", "pacote", "msi", "exe"],
    body: [
      "`npm run tauri build` gera o instalador da sua plataforma em src-tauri/target/release/bundle.",
      "Os releases saem por tag via GitHub Actions (dê push numa tag `v*` → a CI compila Windows + macOS, assina os artefatos do updater e cria o rascunho do release). A checagem de tipos do frontend é `npx tsc --noEmit`; os testes do Rust são `cargo test` em src-tauri.",
    ],
  },
  {
    id: "dev-structure",
    category: "developers",
    title: "Onde fica o código",
    keywords: ["estrutura", "organização", "arquivos", "módulos", "arquitetura", "onde está"],
    body: [
      "Frontend (src/): pages/ (Download, Library, Projects, Settings, Help), components/ (Scrubber, Onboarding, HelpHint…), lib/ (settings, downloads, types, helpContent).",
      "Backend (src-tauri/src/): lib.rs conecta tudo; os módulos incluem download/direct, library, settings, tools (ffmpeg/deno sob demanda), transcode, metadata, playlist, preview, media_extract, clipboard, bridge (servidor da extensão), tray, updater, diag.",
      "Docs (docs/): ARCHITECTURE, ROADMAP, NOTES, IMPROVEMENTS, MANUAL. Leia esses primeiro.",
    ],
  },
  {
    id: "dev-add-feature",
    category: "developers",
    title: "Adicionar um comando ou recurso",
    keywords: ["adicionar comando", "novo recurso", "tauri command", "invoke", "backend"],
    body: [
      "Backend: escreva um `#[tauri::command]` no módulo adequado, registre na lista do `generate_handler!` em lib.rs e chame do frontend com `invoke(\"seu_comando\", { args })`.",
      "Para trabalhos longos, emita eventos (Emitter) e use `listen()` no frontend para o progresso — é assim que downloads/transcodes transmitem status. Mantenha a mudança neutra em comportamento e rode cargo test + tsc.",
    ],
  },
  {
    id: "dev-extension",
    category: "developers",
    title: "Mexer na extensão do navegador",
    keywords: ["dev extensão", "content script", "background", "manifest", "ponte", "loopback"],
    body: [
      "A extensão (extension/) é um add-on MV3 puro — sem etapa de build. Edite um arquivo e clique no ícone de recarregar em chrome://extensions.",
      "Ela fala com o servidor de ponte local do app (127.0.0.1:47821 por padrão) usando o token de pareamento do chrome.storage.local como autenticação. background.js roteia mensagens; content-*.js adicionam os botões nas páginas; bridge.js é o cliente HTTP compartilhado. Veja extension/README.md.",
    ],
  },
  {
    id: "dev-docs",
    category: "developers",
    title: "Como funciona esta Ajuda / a documentação",
    keywords: ["ajuda", "adicionar tópico", "traduzir", "i18n", "interrogação", "tooltip", "manual"],
    body: [
      "A Ajuda do app é renderizada a partir de src/lib/helpContent.ts (espelhado em docs/MANUAL.md). Para adicionar um tópico, acrescente um HelpEntry com uma categoria; o id de cada entrada é uma âncora estável.",
      "Os tooltips (?) (HelpHint) apontam para /help#<id>, e a busca (lib/helpSearch.ts) tolera erros de digitação e sinônimos. Tradução é drop-in: crie helpContent.<lang>.ts com os mesmos ids e um case em getHelpContent — sem mudar nenhuma página. O português vive em helpContent.pt.ts.",
    ],
  },
  {
    id: "dev-contribute",
    category: "developers",
    title: "Contribuindo",
    keywords: ["contribuir", "pull request", "pr", "issue", "ajudar", "github"],
    body: [
      "Issues e PRs são bem-vindos. Mantenha as mudanças focadas, rode `npx tsc --noEmit` e `cargo test` antes de abrir um PR, e descreva o que mudou e por quê.",
      "Não é programador? Abrir reports claros com logs (veja \"Como reportar um bug direito\") e testar novas versões é genuinamente valioso.",
    ],
  },
];

export const HELP_CONTENT_PT: HelpContent = {
  categories: CATEGORIES_PT,
  entries: ENTRIES_PT,
};
