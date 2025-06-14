// Script para interatividade da página
document.addEventListener('DOMContentLoaded', function() {
  // Inicializar tooltips
  var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl);
  });
  
  // Animação de fade-in nos elementos
  const fadeElements = document.querySelectorAll('.fade-in');
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1 });
  
  fadeElements.forEach(element => {
    observer.observe(element);
  });
  
  // Tornar os botões de comodidades interativos
  const amenityBtns = document.querySelectorAll('.amenity-btn');
  
  amenityBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      this.classList.toggle('active');
      
      // Mostrar informações adicionais quando ativo
      const amenityName = this.querySelector('p').textContent;
      const isActive = this.classList.contains('active');
      
      if (isActive) {
        showAmenityInfo(amenityName, this);
      }
    });
  });
  
  // Validação de datas
  const checkinInput = document.getElementById('checkin');
  const checkoutInput = document.getElementById('checkout');
  
  if (checkinInput && checkoutInput) {
    // Definir data mínima como hoje
    const today = new Date().toISOString().split('T')[0];
    checkinInput.setAttribute('min', today);
    
    checkinInput.addEventListener('change', function() {
      // Data de saída deve ser posterior à data de entrada
      checkoutInput.setAttribute('min', this.value);
      
      // Se a data de saída for anterior à nova data de entrada, ajustar
      if (checkoutInput.value && checkoutInput.value < this.value) {
        checkoutInput.value = this.value;
      }
    });
  }
  
  // Buscar chácaras e preencher select
  fetch('http://localhost:3000/chacaras')
    .then(r => r.json())
    .then(chacaras => {
      const select = document.getElementById('chacara');
      if (select) {
        chacaras.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id; // agora envia o id
          opt.textContent = c.nome;
          select.appendChild(opt);
        });
      }
    });

  // Event listener do botão de reserva (corrigido)
  const btnReservar = document.getElementById('btn-reservar');
  if (btnReservar) {
    btnReservar.addEventListener('click', function(e) {
      e.preventDefault();
      submitReservation();
    });
  }

  carregarChacaras();

  // Modal reserva
  const reservaModal = new bootstrap.Modal(document.getElementById('modalReserva'));
  document.getElementById('reservation-form').addEventListener('submit', function(e) {
    e.preventDefault();
    submitReservation(reservaModal);
  });
});

// Função para mostrar informações adicionais sobre comodidades
function showAmenityInfo(amenityName, element) {
  const amenityInfo = {
    'Piscina': 'Piscina ampla com 8m x 4m, área infantil e deck com espreguiçadeiras.',
    'Área Verde': 'Mais de 5.000m² de área verde com jardim, pomar e trilha ecológica.',
    'Espaço para Eventos': 'Salão com capacidade para 50 pessoas, sistema de som e iluminação.',
    'Wi-Fi': 'Internet de alta velocidade disponível em toda a propriedade.',
    'Churrasqueira': 'Churrasqueira completa com utensílios, forno de pizza e área gourmet.',
    'Campo de Futebol': 'Campo gramado de 30m x 15m com traves e iluminação.',
    'Cozinha Completa': 'Cozinha equipada com fogão, geladeira, micro-ondas e utensílios.',
    'Estacionamento': 'Estacionamento privativo para até 10 carros com segurança.'
  };
  
  // Verificar se já existe um elemento de informação
  let infoElement = element.nextElementSibling;
  if (infoElement && infoElement.classList.contains('amenity-info')) {
    infoElement.remove();
    return;
  }
  
  // Criar elemento de informação
  const info = document.createElement('div');
  info.className = 'amenity-info alert alert-success mt-2 animate__animated animate__fadeIn';
  info.textContent = amenityInfo[amenityName] || `Informações sobre ${amenityName}`;
  
  // Inserir após o botão
  element.parentNode.insertBefore(info, element.nextSibling);
  
  // Remover após 5 segundos
  setTimeout(() => {
    info.classList.add('animate__fadeOut');
    setTimeout(() => {
      info.remove();
      element.classList.remove('active');
    }, 1000);
  }, 5000);
}

// Função para enviar reserva para Neo4j
function submitReservation(modal) {
  // Mostrar indicador de carregamento
  document.getElementById('loading').style.display = 'block';
  document.getElementById('reservation-success').style.display = 'none';
  document.getElementById('reservation-error').style.display = 'none';

  // Coletar dados do formulário
  const formData = {
    nome: document.getElementById('nome').value,
    email: document.getElementById('email').value,
    telefone: document.getElementById('telefone').value,
    pessoas: document.getElementById('pessoas').value,
    checkin: document.getElementById('checkin').value,
    checkout: document.getElementById('checkout').value,
    mensagem: document.getElementById('mensagem').value,
    comodidades: {
      piscina: document.getElementById('check-piscina').checked,
      churrasqueira: document.getElementById('check-churrasqueira').checked,
      campo: document.getElementById('check-campo').checked,
      eventos: document.getElementById('check-eventos').checked
    },
    chacara_id: document.getElementById('modal-chacara-id').value
  };

  // Enviar dados para o backend que se conecta ao Neo4j
  fetch('http://localhost:3000/reservas', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(formData)
  })
  .then(response => {
    if (!response.ok) {
      throw new Error('Erro ao processar a reserva');
    }
    return response.json();
  })
  .then(data => {
    // Esconder indicador de carregamento
    document.getElementById('loading').style.display = 'none';
    
    // Mostrar mensagem de sucesso
    document.getElementById('reservation-success').style.display = 'block';
    document.getElementById('reservation-success').textContent = 'Reserva solicitada com sucesso! Código: ' + data.reservationId;
    
    // Limpar campos
    document.getElementById('nome').value = '';
    document.getElementById('email').value = '';
    document.getElementById('telefone').value = '';
    document.getElementById('pessoas').value = '';
    document.getElementById('checkin').value = '';
    document.getElementById('checkout').value = '';
    document.getElementById('mensagem').value = '';
    document.getElementById('chacara').value = '';
    document.getElementById('check-piscina').checked = false;
    document.getElementById('check-churrasqueira').checked = false;
    document.getElementById('check-campo').checked = false;
    document.getElementById('check-eventos').checked = false;
  })
  .catch(error => {
    console.error('Erro:', error);
    
    // Esconder indicador de carregamento
    document.getElementById('loading').style.display = 'none';
    
    // Mostrar mensagem de erro
    document.getElementById('reservation-error').style.display = 'block';
    document.getElementById('reservation-error').textContent = 'Erro ao processar a reserva. Por favor, tente novamente.';
  });
}

function carregarChacaras() {
  fetch('http://localhost:3000/chacaras')
    .then(r => r.json())
    .then(chacaras => {
      const list = document.getElementById('chacaras-list');
      list.innerHTML = '';
      chacaras.forEach(c => {
        const card = document.createElement('div');
        card.className = 'col-md-4';
        card.innerHTML = `
          <div class="card shadow-sm h-100">
            <div class="card-body d-flex flex-column">
              <h5 class="card-title">${c.nome}</h5>
              <div class="mb-2" id="reservas-chacara-${c.id}">
                <span class="text-muted">Carregando reservas...</span>
              </div>
              <button class="btn btn-success mt-auto" onclick="abrirReserva(${c.id}, '${c.nome}')">Reservar</button>
            </div>
          </div>
        `;
        list.appendChild(card);
        carregarReservasChacara(c.id);
      });
    });
}

function carregarReservasChacara(chacara_id) {
  fetch(`http://localhost:3000/reservas?chacara_id=${chacara_id}`)
    .then(r => r.json())
    .then(reservas => {
      const div = document.getElementById(`reservas-chacara-${chacara_id}`);
      if (!reservas.length) {
        div.innerHTML = '<span class="text-muted">Nenhuma reserva ativa.</span>';
        return;
      }
      div.innerHTML = reservas.map(r => `
        <div class="border rounded p-2 mb-2 d-flex justify-content-between align-items-center">
          <div>
            <strong>${r.nome}</strong> <br>
            <small>${r.checkin} até ${r.checkout}</small>
          </div>
          <button class="btn btn-sm btn-outline-danger" onclick="cancelarReserva(${r.id}, ${chacara_id})">Cancelar</button>
        </div>
      `).join('');
    });
}

window.abrirReserva = function(chacara_id, chacara_nome) {
  document.getElementById('modal-chacara-id').value = chacara_id;
  document.getElementById('reservation-form').reset();
  document.getElementById('reservation-error').style.display = 'none';
  new bootstrap.Modal(document.getElementById('modalReserva')).show();
};

window.cancelarReserva = function(id, chacara_id) {
  if (!confirm('Tem certeza que deseja cancelar esta reserva?')) return;
  fetch(`http://localhost:3000/reservas/${id}`, { method: 'DELETE' })
    .then(r => r.json())
    .then(() => carregarReservasChacara(chacara_id));
};
