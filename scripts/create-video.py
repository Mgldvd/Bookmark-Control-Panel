#!/usr/bin/env python3
"""Make a short, silent MP4 presentation from the real UI screenshots."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / 'store/media'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
SCENES = [
    ('01-board.png', 'Tus marcadores, a la vista', 'Bookmark Control Panel'),
    ('02-grid-and-groups.png', 'Organiza por proyectos', 'Carpetas reales y grupos personales'),
    ('11-search.png', 'Encuentra lo que necesitas', 'Busca por título, dirección o carpeta'),
    ('04-strip-profiles.png', 'Cambia de contexto', 'Perfiles para tu trabajo y tu tiempo libre'),
    ('06-minimal-gradient.png', 'Haz tuya cada nueva pestaña', 'Modo mínimo, colores y fondos integrados'),
    ('08-light-theme.png', 'Empieza con una vista más clara', 'Para Firefox · English / Español'),
]

with tempfile.TemporaryDirectory(prefix='amo-video-') as temp:
    temp = Path(temp)
    for index, (filename, title, subtitle) in enumerate(SCENES):
        canvas = Image.new('RGB', (1280, 800), '#101219')
        shot = Image.open(MEDIA / filename).convert('RGB').resize((1088, 680))
        canvas.paste(shot, (96, 112))
        draw = ImageDraw.Draw(canvas)
        draw.text((44, 18), title, font=ImageFont.truetype(FONT, 30), fill='#f4f5ff')
        draw.text((44, 61), subtitle, font=ImageFont.truetype(FONT, 18), fill='#b8bbd1')
        draw.text((1020, 66), 'Datos ficticios · Demo', font=ImageFont.truetype(FONT, 13), fill='#8b90a9')
        canvas.save(temp / f'{index:02d}.png')
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
        '-framerate', '2/5', '-i', str(temp / '%02d.png'),
        '-vf', "fps=30,fade=t=in:st=0:d=0.3,fade=t=out:st=14.6:d=0.4",
        '-c:v', 'libx264', '-crf', '19', '-preset', 'medium',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        str(MEDIA / 'presentation-es.mp4'),
    ], check=True)
print(MEDIA / 'presentation-es.mp4')
