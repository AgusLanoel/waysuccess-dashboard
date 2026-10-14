# Esquema propuesto para GHL (revisar antes de crear)

## Campos personalizados del CONTACTO (atribución; los llena la landing/calendario, no el equipo)
| Campo | Tipo | Ejemplo |
|---|---|---|
| ws_visitor_id | Texto | 7f3c… |
| ws_first_ad_id | Texto | 120246954158690088 |
| ws_first_adset_id | Texto | |
| ws_first_campaign_id | Texto | |
| ws_first_click_at | Fecha/hora | |
| ws_last_ad_id | Texto | |
| ws_last_adset_id | Texto | |
| ws_last_campaign_id | Texto | |
| ws_last_click_at | Fecha/hora | |
| ws_fbclid | Texto | |
| ws_placement | Texto | instagram_reels |
| industria | Lista | Real estate, … (los valores que ya usan) |

## Pipeline "Ventas" (una oportunidad por agenda)
Agendado → Calificado → Asistió → Oferta hecha → Vendido
Ramas de salida: No calificado · No-show · Canceló · Perdido

## Campos de la OPORTUNIDAD (los carga el closer)
| Campo | Tipo |
|---|---|
| closer | Lista (Ale, Federico, Agustín, …) |
| origen | Lista: Ads, Orgánico, Referidos, Afiliados |
| vendido_usd | Moneda |
| fecha_cierre | Fecha |
| objeciones | Selección múltiple: Garantía, Caro, Socio, Querer hacerlo después, Estoy viendo otras opciones, No tomo decisiones en caliente, Capacidad de pago, Malas experiencias, Capacidad de él mismo, Confianza en el vehículo, Confianza en Ale, Confianza en Closer, Confianza en la empresa, Miedo al éxito, Tengo que pensarlo, Ghosteó, Contrato, Logístico, Lo quiere hacer por su cuenta |
| campaña_interna | Texto (VSL, etc.; histórico) |

## Pagos (cobrado)
Cada cobro como registro aparte: si cobran en GHL Payments, se lee de ahí; si no, un campo "pagos" en la oportunidad (monto + fecha), uno por cuota.

## Preguntas abiertas
1. ¿Los cobros pasan por GHL Payments/Stripe o por otro lado?
2. ¿Hoy la calificación la decide un workflow if/else de GHL? ¿Con qué criterio? (Para que "Calificado" se mueva solo.)
3. ¿Tienen ya un pipeline en uso? (Lo adaptamos en vez de crear otro.)
