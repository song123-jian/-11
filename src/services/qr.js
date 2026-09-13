import QRCode from 'qrcode'
import jsQR from 'jsqr'

export function renderQr(text) {
  return QRCode.toDataURL(text, {
    width: 360,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#17324d', light: '#ffffff' },
  })
}

export function readQr(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, canvas.width, canvas.height)
      const result = jsQR(data.data, data.width, data.height)
      URL.revokeObjectURL(url)
      resolve(result?.data || '')
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('二维码图片无法读取'))
    }
    image.src = url
  })
}
