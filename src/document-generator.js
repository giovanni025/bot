const fs = require('fs');
const path = require('path');
const { createReport } = require('docx-templates');

// Diretório base para templates
const TEMPLATES_DIR = path.join(__dirname, 'templates');

/**
 * Cria diretórios necessários
 */
function createDirectories() {
    const dirs = [
        path.join(__dirname, 'images', 'temp'),
        path.join(__dirname, 'temp')
    ];
    
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 Diretório criado: ${dir}`);
        }
    });
}

/**
 * Seleciona aleatoriamente um template DOCX
 */
function selectRandomTemplate(medico) {
    try {
        let medicoDir = medico;
        
        if (medico === 'aleatorio') {
            const medicoDirs = fs.readdirSync(TEMPLATES_DIR);
            medicoDir = medicoDirs[Math.floor(Math.random() * medicoDirs.length)];
        }
        
        const medicoPath = path.join(TEMPLATES_DIR, medicoDir);
        
        if (!fs.existsSync(medicoPath)) {
            throw new Error(`Diretório do médico não encontrado: ${medicoPath}`);
        }
        
        const docxFiles = fs.readdirSync(medicoPath)
            .filter(file => file.toLowerCase().endsWith('.docx'));
        
        if (docxFiles.length === 0) {
            throw new Error(`Nenhum arquivo DOCX encontrado em: ${medicoPath}`);
        }
        
        const randomDocx = docxFiles[Math.floor(Math.random() * docxFiles.length)];
        return path.join(medicoPath, randomDocx);
    } catch (error) {
        console.error('❌ Erro ao selecionar template:', error);
        throw error;
    }
}

/**
 * Formata CPF com pontos e hífen
 */
function formatarCPF(cpf) {
    try {
        // Remove tudo que não é número
        const numerosCPF = cpf.replace(/\D/g, '');
        
        if (numerosCPF.length !== 11) {
            console.warn(`⚠️ CPF inválido: ${cpf}, usando sem formatação`);
            return cpf;
        }
        
        // Formata: XXX.XXX.XXX-XX
        const cpfFormatado = numerosCPF.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        console.log(`📋 CPF formatado: ${cpf} → ${cpfFormatado}`);
        
        return cpfFormatado;
    } catch (error) {
        console.error('❌ Erro ao formatar CPF:', error);
        return cpf;
    }
}

/**
 * Formata data para formato brasileiro (DD/MM/AAAA)
 */
function formatarDataBrasileira(dataString) {
    try {
        let data;
        
        // Se já está no formato brasileiro DD/MM/AAAA, mantém
        if (dataString.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
            console.log(`📅 Data já está no formato brasileiro: ${dataString}`);
            return dataString;
        }
        
        // Tenta parsear diferentes formatos
        if (dataString.includes('/')) {
            const partes = dataString.split('/');
            if (partes[0].length === 4) {
                // Formato AAAA/MM/DD
                data = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
            } else {
                // Formato DD/MM/AAAA
                data = new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]));
            }
        } else if (dataString.includes('-')) {
            const partes = dataString.split('-');
            if (partes[0].length === 4) {
                // Formato AAAA-MM-DD
                data = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
            } else {
                // Formato DD-MM-AAAA
                data = new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]));
            }
        } else {
            data = new Date(dataString);
        }
        
        if (isNaN(data.getTime())) {
            console.warn(`⚠️ Data inválida: ${dataString}, usando data atual`);
            data = new Date();
        }
        
        const dia = String(data.getDate()).padStart(2, '0');
        const mes = String(data.getMonth() + 1).padStart(2, '0');
        const ano = data.getFullYear();
        
        const dataBrasileira = `${dia}/${mes}/${ano}`;
        console.log(`📅 Data formatada: ${dataString} → ${dataBrasileira}`);
        
        return dataBrasileira;
        
    } catch (error) {
        console.error('❌ Erro ao formatar data:', error);
        const hoje = new Date();
        const dia = String(hoje.getDate()).padStart(2, '0');
        const mes = String(hoje.getMonth() + 1).padStart(2, '0');
        const ano = hoje.getFullYear();
        return `${dia}/${mes}/${ano}`;
    }
}

/**
 * Formata horário para HH:MM:SS
 */
function formatarHorario(horario) {
    try {
        if (!horario) {
            const agora = new Date();
            return agora.toLocaleTimeString('pt-BR', { 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
            });
        }
        
        // Se já está no formato HH:MM:SS, mantém
        if (horario.match(/^\d{2}:\d{2}:\d{2}$/)) {
            console.log(`⏰ Horário já está formatado: ${horario}`);
            return horario;
        }
        
        // Se está no formato HH:MM, adiciona segundos
        if (horario.match(/^\d{1,2}:\d{2}$/)) {
            const [hora, minuto] = horario.split(':');
            const horarioFormatado = `${String(hora).padStart(2, '0')}:${minuto}:00`;
            console.log(`⏰ Horário formatado: ${horario} → ${horarioFormatado}`);
            return horarioFormatado;
        }
        
        // Se é só números, tenta interpretar como HHMM ou HH
        if (horario.match(/^\d+$/)) {
            if (horario.length === 4) {
                // HHMM
                const hora = horario.substring(0, 2);
                const minuto = horario.substring(2, 4);
                const horarioFormatado = `${hora}:${minuto}:00`;
                console.log(`⏰ Horário formatado: ${horario} → ${horarioFormatado}`);
                return horarioFormatado;
            } else if (horario.length <= 2) {
                // HH
                const horarioFormatado = `${String(horario).padStart(2, '0')}:00:00`;
                console.log(`⏰ Horário formatado: ${horario} → ${horarioFormatado}`);
                return horarioFormatado;
            }
        }
        
        // Tenta parsear como Date
        const data = new Date(`2000-01-01 ${horario}`);
        if (!isNaN(data.getTime())) {
            const horarioFormatado = data.toLocaleTimeString('pt-BR', { 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
            });
            console.log(`⏰ Horário formatado: ${horario} → ${horarioFormatado}`);
            return horarioFormatado;
        }
        
        console.warn(`⚠️ Horário em formato não reconhecido: ${horario}`);
        return horario;
        
    } catch (error) {
        console.error('❌ Erro ao formatar horário:', error);
        const agora = new Date();
        return agora.toLocaleTimeString('pt-BR', { 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
    }
}

/**
 * Converte número para extenso
 */
function numeroPorExtenso(numero) {
    const unidades = [
        'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 
        'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 
        'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 
        'dezessete', 'dezoito', 'dezenove', 'vinte', 'vinte e um',
        'vinte e dois', 'vinte e três', 'vinte e quatro', 'vinte e cinco',
        'vinte e seis', 'vinte e sete', 'vinte e oito', 'vinte e nove', 'trinta'
    ];
    
    if (numero >= 0 && numero <= 30) {
        return unidades[numero];
    }
    return numero.toString();
}

/**
 * Converte data para formato extenso (ex: "10 de junho de 2025")
 */
function dataParaExtenso(dataString) {
    try {
        const meses = [
            'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
            'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
        ];
        
        let data;
        
        // Primeiro formata para brasileiro, depois converte para extenso
        const dataBrasileira = formatarDataBrasileira(dataString);
        const [dia, mes, ano] = dataBrasileira.split('/');
        data = new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia));
        
        if (isNaN(data.getTime())) {
            console.warn(`⚠️ Data inválida: ${dataString}, usando data atual`);
            data = new Date();
        }
        
        const diaNum = data.getDate();
        const mesNome = meses[data.getMonth()];
        const anoNum = data.getFullYear();
        
        const dataExtenso = `${diaNum} de ${mesNome} de ${anoNum}`;
        console.log(`📅 Data convertida para extenso: ${dataString} → ${dataExtenso}`);
        
        return dataExtenso;
        
    } catch (error) {
        console.error('❌ Erro ao converter data para extenso:', error);
        const hoje = new Date();
        const meses = [
            'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
            'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
        ];
        return `${hoje.getDate()} de ${meses[hoje.getMonth()]} de ${hoje.getFullYear()}`;
    }
}

/**
 * Edita DOCX usando docx-templates
 */
async function editDocx(docxPath, data) {
    try {
        console.log('📝 Editando DOCX...');
        
        const template = fs.readFileSync(docxPath);
        
        const templateData = {
            nome: data.nome.toUpperCase(),
            cpf: formatarCPF(data.cpf),
            data_entrada: formatarDataBrasileira(data.dataEntrada),
            data_entrada_Extenso: dataParaExtenso(data.dataEntrada),
            hora_entrada: formatarHorario(data.horarioEntrada),
            motivo: (data.cid || 'H10').toUpperCase(),
            dias: `${String(data.qtdDias || 1).padStart(2, '0')} (${numeroPorExtenso(data.qtdDias || 1)})`,
            dia_ou_dias: (data.qtdDias || 1) === 1 ? 'dia' : 'dias',
            data_saida: formatarDataBrasileira(data.dataEntrada),
            hora_saida: formatarHorario(data.horarioSaida || new Date().toLocaleTimeString('pt-BR', { 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
            })),
            nome_medico: data.nomeMedico ? data.nomeMedico.toUpperCase() : 'ADELAIDE MARTINS TUPYNAMBA'
        };
        
        console.log('📋 Dados para substituição:', templateData);
        
        const buffer = await createReport({
            template,
            data: templateData,
            cmdDelimiter: ['{', '}'],
            failFast: false,
            rejectNullish: false
        });
        
        const outputDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const tempDocxPath = path.join(outputDir, `${data.orderId}_edited.docx`);
        fs.writeFileSync(tempDocxPath, buffer);
        
        console.log('✅ DOCX editado com sucesso');
        return tempDocxPath;
        
    } catch (error) {
        console.error('❌ Erro ao editar DOCX:', error);
        throw error;
    }
}

/**
 * Converte DOCX para PDF e depois para JPG
 */
async function convertDocxToImage(docxPath, outputImagePath) {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
        console.log('🔄 Convertendo DOCX → PDF → JPG...');
        
        const tempDir = path.join(__dirname, 'temp');
        const docxFileName = path.basename(docxPath, '.docx');
        const pdfPath = path.join(tempDir, `${docxFileName}.pdf`);
        
        // DOCX → PDF usando LibreOffice
        console.log('📄 Convertendo DOCX para PDF...');
        const libreOfficeCmd = `libreoffice --headless --convert-to pdf --outdir "${tempDir}" "${docxPath}"`;
        
        try {
            await execAsync(libreOfficeCmd, { timeout: 30000 });
            console.log('✅ DOCX convertido para PDF');
        } catch (libreError) {
            console.log('🔄 Tentando comando alternativo...');
            const altCmd = `soffice --headless --convert-to pdf --outdir "${tempDir}" "${docxPath}"`;
            await execAsync(altCmd, { timeout: 30000 });
            console.log('✅ DOCX convertido para PDF');
        }
        
        if (!fs.existsSync(pdfPath)) {
            throw new Error('PDF não foi gerado pelo LibreOffice');
        }
        
        // PDF → JPG usando ImageMagick
        console.log('🖼️ Convertendo PDF para JPG...');
        const magickCmd = `convert -density 300 -quality 95 -background white -flatten "${pdfPath}[0]" "${outputImagePath}"`;
        console.log(`🔧 Comando ImageMagick: ${magickCmd}`);
        
        const result = await execAsync(magickCmd, { timeout: 20000 });
        console.log('📝 Saída do ImageMagick:', result.stdout);
        
        if (!fs.existsSync(outputImagePath)) {
            // Verificar se foi criado com numeração
            const dir = path.dirname(outputImagePath);
            const basename = path.basename(outputImagePath, '.jpg');
            const possibleFiles = [
                path.join(dir, `${basename}-0.jpg`),
                path.join(dir, `${basename}.jpg.0`),
                path.join(dir, `${basename}-1.jpg`)
            ];
            
            let foundFile = null;
            for (const file of possibleFiles) {
                if (fs.existsSync(file)) {
                    foundFile = file;
                    break;
                }
            }
            
            if (foundFile) {
                console.log(`🔄 Movendo arquivo de ${foundFile} para ${outputImagePath}`);
                fs.renameSync(foundFile, outputImagePath);
            } else {
                throw new Error('ImageMagick não criou o arquivo');
            }
        }
        
        console.log('✅ PDF convertido para JPG');
        
        // Limpeza: remover PDF temporário
        if (fs.existsSync(pdfPath)) {
            fs.unlinkSync(pdfPath);
        }
        
        return outputImagePath;
        
    } catch (error) {
        console.error('❌ Erro na conversão:', error);
        throw error;
    }
}

/**
 * Função principal: Gera documento
 */
async function generateDocument(data) {
    const startTime = Date.now();
    let tempDocxPath = null;
    
    try {
        console.log(`🏥 Iniciando geração de documento para: ${data.nome}, ID: ${data.orderId}`);
        
        createDirectories();
        
        // Validar dados obrigatórios
        if (!data.nome || !data.cpf || !data.dataEntrada || !data.horarioEntrada) {
            throw new Error('Dados obrigatórios faltando (nome, cpf, dataEntrada, horarioEntrada)');
        }
        
        // Selecionar template
        const templatePath = selectRandomTemplate(data.medico || 'aleatorio');
        console.log(`📄 Template selecionado: ${templatePath}`);
        
        // Editar DOCX
        tempDocxPath = await editDocx(templatePath, data);
        
        // Converter para JPG
        const imagePath = path.join(__dirname, 'images', 'temp', `${data.orderId}.jpg`);
        await convertDocxToImage(tempDocxPath, imagePath);
        
        // Verificação final
        if (!fs.existsSync(imagePath)) {
            throw new Error('Arquivo de imagem não foi criado');
        }
        
        const finalStats = fs.statSync(imagePath);
        if (finalStats.size === 0) {
            throw new Error('Arquivo de saída está vazio');
        }
        
        // Verificar se é JPG válido
        const buffer = fs.readFileSync(imagePath);
        const jpgSignature = Buffer.from([0xFF, 0xD8, 0xFF]);
        const isValidJpg = buffer.slice(0, 3).equals(jpgSignature);
        
        if (!isValidJpg) {
            throw new Error('Arquivo gerado não é um JPG válido');
        }
        
        const executionTime = Date.now() - startTime;
        
        console.log(`🎉 Documento gerado com sucesso em ${executionTime}ms`);
        console.log(`📊 Tamanho do arquivo: ${finalStats.size} bytes`);
        console.log(`📁 Arquivo salvo em: ${imagePath}`);
        
        return {
            success: true,
            imagePath: imagePath,
            relativeImagePath: `/images/temp/${data.orderId}.jpg`,
            executionTime: executionTime,
            fileSize: finalStats.size,
            method: 'DOCX → LibreOffice → JPG'
        };
        
    } catch (error) {
        const executionTime = Date.now() - startTime;
        console.error(`❌ Erro ao gerar documento após ${executionTime}ms:`, error);
        
        // Limpeza em caso de erro
        const imagePath = path.join(__dirname, 'images', 'temp', `${data.orderId}.jpg`);
        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
        
        throw error;
        
    } finally {
        // Limpeza do DOCX temporário
        if (tempDocxPath && fs.existsSync(tempDocxPath)) {
            fs.unlinkSync(tempDocxPath);
            console.log('🧹 Arquivo DOCX temporário removido');
        }
    }
}

/**
 * Verifica se um documento foi gerado
 */
function documentExists(orderId) {
    try {
        const imagePath = path.join(__dirname, 'images', 'temp', `${orderId}.jpg`);
        const exists = fs.existsSync(imagePath);
        
        if (exists) {
            const stats = fs.statSync(imagePath);
            const buffer = fs.readFileSync(imagePath);
            const jpgSignature = Buffer.from([0xFF, 0xD8, 0xFF]);
            const isValidJpg = buffer.slice(0, 3).equals(jpgSignature);
            
            console.log(`📋 Documento ${orderId}: ${stats.size} bytes, JPG válido: ${isValidJpg}`);
            return stats.size > 0 && isValidJpg;
        } else {
            console.log(`📋 Documento ${orderId} não encontrado`);
            return false;
        }
    } catch (error) {
        console.error('❌ Erro ao verificar documento:', error);
        return false;
    }
}

/**
 * Remove arquivos antigos (limpeza automática)
 */
function cleanupOldFiles(maxAgeHours = 24) {
    try {
        const dirs = [
            path.join(__dirname, 'images', 'temp'),
            path.join(__dirname, 'temp')
        ];
        
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) return;
            
            const files = fs.readdirSync(dir);
            const now = Date.now();
            const maxAge = maxAgeHours * 60 * 60 * 1000;
            
            let deletedCount = 0;
            
            files.forEach(file => {
                const filePath = path.join(dir, file);
                const stats = fs.statSync(filePath);
                
                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                }
            });
            
            if (deletedCount > 0) {
                console.log(`🧹 Limpeza ${dir}: ${deletedCount} arquivos removidos`);
            }
        });
    } catch (error) {
        console.error('❌ Erro na limpeza:', error);
    }
}

module.exports = {
    generateDocument,
    documentExists,
    cleanupOldFiles
};