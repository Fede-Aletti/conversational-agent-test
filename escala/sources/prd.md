# ESCALA — AI Airline Customer Experience

> Source: functional document provided by the product owner (2026-10-17), kept verbatim in Spanish.
> Engineering assumptions for the prototype are in the appendix at the end (English).

## 1. Visión del producto

**Escala** es una plataforma experimental de atención al cliente para aerolíneas, impulsada por inteligencia artificial conversacional.

Su propósito es demostrar cómo un agente inteligente puede gestionar situaciones complejas de viaje de principio a fin, interactuando naturalmente con pasajeros, comprendiendo sus necesidades, consultando información y resolviendo problemas que normalmente requieren múltiples interacciones con un centro de atención.

El producto tomará como referencia a **Aerolíneas Argentinas**, sus servicios y su documentación pública.

Escala será un prototipo independiente, sin afiliación oficial con la aerolínea. Las reservas, operaciones y datos privados serán simulados, mientras que la información pública podrá basarse en fuentes oficiales.

**Propuesta de valor:** transformar la atención al pasajero desde un sistema que responde preguntas hacia uno que comprende problemas y ayuda a resolverlos.

---

## 2. El problema de negocio

La atención al cliente en la industria aeronáutica presenta desafíos particulares:

- **Fragmentación:** una solicitud puede involucrar reservas, vuelos, tarifas, equipaje y disponibilidad.
- **Complejidad:** las soluciones dependen de múltiples condiciones y reglas de negocio.
- **Falta de continuidad:** los pasajeros frecuentemente tienen que repetir información al cambiar de canal o representante.
- **Escalabilidad:** cancelaciones masivas y demoras generan picos de demanda.
- **Costos operativos:** muchas consultas requieren intervención humana, incluso cuando podrían resolverse mediante procesos automatizados.
- **Experiencia del cliente:** los pasajeros necesitan soluciones rápidas, especialmente ante situaciones urgentes.

Los chatbots tradicionales suelen resolver consultas aisladas, pero tienen dificultades para ejecutar procesos que requieren varias decisiones conectadas.

Escala busca resolver esa limitación.

## 3. Objetivos del proyecto

### Objetivo principal

Construir un agente conversacional que pueda comprender, gestionar y resolver solicitudes complejas relacionadas con viajes aéreos, minimizando la intervención humana sin comprometer la seguridad ni la exactitud de las operaciones.

### Objetivos secundarios

1. Ofrecer una experiencia conversacional natural mediante chat y voz.
2. Mantener el contexto durante toda la conversación, incluso ante interrupciones o cambios de intención.
3. Resolver solicitudes que involucren múltiples áreas del negocio.
4. Consultar y aplicar políticas reales de la aerolínea cuando corresponda.
5. Ejecutar operaciones simuladas con resultados verificables.
6. Reconocer cuándo una solicitud requiere intervención humana.
7. Evaluar eficiencia operativa, calidad de resolución, tiempos de respuesta y costos.
8. Permitir comparar diferentes enfoques de implementación y optimización.

---

## 4. Alcance funcional

### A. Consultas generales

El pasajero podrá consultar:

- Políticas de equipaje y franquicias.
- Condiciones de check-in.
- Requisitos de viaje.
- Condiciones de tarifas.
- Procedimientos de cambios y devoluciones.
- Servicios disponibles.

Las respuestas deberán estar fundamentadas en información verificable, preferentemente documentación oficial.

### B. Gestión de reservas

El agente deberá poder:

- Localizar una reserva simulada.
- Identificar pasajeros e itinerarios.
- Consultar condiciones y servicios contratados.
- Detectar restricciones que afecten una operación.
- Gestionar solicitudes de modificación de reservas.

### C. Estado de vuelos e incidencias

El agente deberá comprender situaciones como:

- Vuelos demorados.
- Vuelos cancelados.
- Conexiones perdidas o comprometidas.
- Reprogramaciones.
- Cambios de itinerario.

Deberá evaluar cómo un incidente afecta al viaje completo, no solamente a un tramo individual.

### D. Reprogramaciones

El sistema deberá poder:

- Identificar el motivo del cambio.
- Determinar qué condiciones se aplican.
- Consultar alternativas disponibles.
- Evaluar restricciones de horarios y conexiones.
- Presentar opciones al pasajero.
- Solicitar confirmación.
- Ejecutar una modificación simulada y verificar su resultado.

### E. Equipaje y servicios adicionales

El agente deberá poder consultar servicios contratados y determinar cómo se ven afectados por un cambio de itinerario.

No debe asumir que un servicio adicional se transfiere automáticamente a una nueva reserva.

### F. Derivación a atención humana

Cuando una operación no pueda completarse, el agente deberá explicar la situación y facilitar una derivación con el contexto necesario.

El pasajero no debería tener que comenzar su explicación desde cero.

---

## 5. Escenario principal de demostración

### Caso: cancelación de vuelo con conexión y múltiples pasajeros

**Situación inicial**

Dos pasajeros tienen una reserva de Córdoba a Bariloche con conexión en Aeroparque.

El primer vuelo es cancelado.

Uno de los pasajeros ya realizó el check-in y ambos contrataron servicios adicionales de equipaje.

Necesitan llegar a Bariloche, como máximo, al día siguiente.

**Mensaje inicial del pasajero**

"Hola, viajamos dos de Córdoba a Bariloche con escala en Aeroparque. Me cancelaron el primer vuelo y necesito llegar mañana como máximo. Mi pareja ya hizo el check-in y pagamos equipaje adicional. ¿Nos podés cambiar a los dos sin perder lo que pagamos?"

### Comportamiento esperado

El agente deberá:

1. Comprender que el problema involucra una cancelación, una conexión, dos pasajeros y servicios adicionales.
2. Solicitar únicamente la información necesaria para identificar la reserva.
3. Consultar el itinerario y verificar el estado del vuelo.
4. Determinar las condiciones aplicables a la reprogramación.
5. Reconocer las restricciones asociadas al check-in y los servicios adquiridos.
6. Identificar alternativas que permitan llegar dentro del plazo solicitado.
7. Presentar las opciones explicando sus diferencias y limitaciones.
8. Solicitar autorización explícita antes de realizar modificaciones.
9. Ejecutar la operación simulada cuando esté permitida.
10. Informar el resultado, incluyendo el nuevo itinerario y la situación de los servicios adicionales.

**Criterio de éxito:** el problema completo debe resolverse dentro de una misma conversación, sin perder información, realizar operaciones duplicadas ni inventar resultados.

Si alguna parte no puede resolverse, el agente deberá identificar exactamente qué quedó pendiente y por qué.

---

## 6. Requisitos de comportamiento

**Conversación natural** — Comprender lenguaje cotidiano, expresiones incompletas, correcciones, interrupciones y preguntas adicionales.

**Conciencia del contexto** — Recordar las preferencias, restricciones e información relevante que el pasajero proporcionó durante la conversación.

**Razonamiento orientado a objetivos** — No limitarse a responder literalmente las preguntas. Debe entender qué intenta conseguir el pasajero y guiarlo hacia una resolución viable.

**Precisión y transparencia** — Distinguir información confirmada, información pendiente de consulta y situaciones donde no existe una respuesta confiable.

**Seguridad operativa** — No modificar reservas, confirmar servicios ni generar transacciones sin las autorizaciones y validaciones correspondientes.

**Recuperación ante errores** — Ante información insuficiente, fallos de servicios o alternativas inexistentes, buscar una salida válida sin inventar disponibilidad ni resultados.

**Escalamiento inteligente** — Reconocer sus limitaciones y derivar apropiadamente cuando sea necesario.

---

## 7. Escenarios adicionales de evaluación

| Escenario | Capacidad a evaluar |
|---|---|
| El pasajero no encuentra su reserva | Recuperación e identificación |
| Cambia de destino durante la conversación | Gestión de contexto |
| No existen vuelos alternativos | Manejo de excepciones |
| Un servicio de consulta deja de responder | Recuperación ante fallos |
| El pasajero confirma una operación dos veces | Prevención de duplicados |
| Hay dos pasajeros con condiciones distintas | Razonamiento con múltiples restricciones |
| Una política impide completar el cambio | Cumplimiento de reglas |
| El pasajero solicita atención humana | Derivación contextual |
| Interrumpe una explicación para consultar equipaje | Continuidad conversacional |

---

## 8. Experiencia del usuario

- Interfaz de chat clara y accesible; interacción por voz natural.
- Posibilidad de interrumpir o corregir al asistente.
- Respuestas concisas, comprensibles y adaptadas al contexto.
- Confirmaciones claras antes de acciones importantes.
- Cuando resulte útil: tarjetas de reservas y vuelos, comparación de itinerarios, estado de la gestión, detalle de equipaje y servicios, comprobantes simulados.

La experiencia debe permitir que el usuario entienda qué está haciendo el agente y qué decisiones necesita tomar.

---

## 9. Alcance del prototipo y restricciones

- No requiere acceso a sistemas internos reales de la aerolínea.
- Pasajeros, reservas, vuelos operativos e inventario pueden ser sintéticos.
- Las operaciones transaccionales son simuladas; no hay cargos ni cambios reales.
- Las políticas públicas pueden usarse como referencia, identificando origen y vigencia.
- La experiencia debe identificar claramente su carácter experimental.
- Los datos simulados deben ser coherentes para permitir pruebas reproducibles.

---

## 10. Indicadores de éxito

| Dimensión | Indicador |
|---|---|
| Resolución | Porcentaje de casos completados correctamente |
| Eficiencia | Tiempo y cantidad de interacciones por caso |
| Calidad | Exactitud de las respuestas y cumplimiento de reglas |
| Confiabilidad | Manejo de errores, consistencia y ausencia de operaciones duplicadas |
| Costos | Costo total por conversación y por problema resuelto |

Distinguir conversaciones resueltas automáticamente, derivadas correctamente y fallidas. Optimizar el **costo por problema correctamente resuelto**, no sólo el costo de IA.

---

## 11. Evolución del producto

1. **Experiencia conversacional** — consultas, intenciones, contexto.
2. **Resolución de operaciones** — reservas simuladas, itinerarios, incidentes, reprogramación completa.
3. **Experiencia por voz** — conversaciones habladas fluidas e interrupciones.
4. **Evaluación y optimización** — medir, identificar fallas, optimizar eficiencia, costo y resolución.

## 12. Resultado esperado

Un pasajero puede plantear una situación que involucra distintas áreas del negocio y recibir una solución consistente, verificable y comprensible, sin conocer los procesos internos de la aerolínea.

**El desafío no es construir un chatbot que sepa sobre vuelos. Es construir un agente que sepa resolver problemas de pasajeros.**

Herramientas, arquitectura e infraestructura quedan abiertas al equipo, justificadas por confiabilidad, eficiencia, mantenibilidad, escalabilidad, UX y costo. Priorizar un producto demostrable de extremo a extremo, sin complejidad que no aporte.

---

## Appendix — Engineering assumptions for the prototype

Defaults chosen by the engineering team to close open points. The TDD may refine them; anything marked *open* needs product sign-off at the TDD approval gate.

| Topic | Assumption |
|---|---|
| Platform | GECX / CX Agent Studio app `escala` (see `project-context.md`). Same app serves text and voice. |
| Conversation language | Spanish (Argentina), professional tone with voseo. Voice-friendly: short turns, no markdown-dependent answers. |
| Build scope (this iteration) | Stages 1 + 2, voice-ready instructions. Stage 4 (platform evals/optimization) deferred by credit policy. |
| Rich UI (cards, comparisons) | Out of scope for the bot build; the agent returns concise structured text. A custom web UI is a later iteration. |
| Experimental disclaimer | The greeting states it is an experimental prototype, not affiliated with Aerolíneas Argentinas. |
| Policy knowledge | Curated, versioned policy snippets served by a deterministic tool (source URL + "as of" date per snippet), summarizing public Aerolíneas Argentinas pages. Cheaper and reproducible vs. a data store; a data store can replace it later. |
| Booking backend | Python tools over an in-code synthetic dataset (deterministic). Seeded bookings cover the demo case and every additional evaluation scenario (sec. 7). |
| Identification | Booking code (PNR, 6 chars) + passenger last name. Fallback lookup by last name + flight date + route. |
| Operation safety | Every mutating tool requires an explicit confirmation flag and an idempotency key; repeating a confirmed operation returns the existing result instead of executing twice. |
| Ancillaries on rebooking | Per-service transfer rules in data (e.g. paid extra bag transfers on involuntary change; seat selection does not). Never assumed. |
| Checked-in passenger | Rebooking a checked-in passenger requires the check-in to be cancelled first (simulated tool), and the agent must say so. |
| Service failure | A seeded condition makes the flight-status / availability tool return a timeout-style error, to exercise recovery. |
| Human handoff | Simulated `create_handoff_case` tool returns a case ID and stores a context summary; the agent tells the passenger they won't need to repeat themselves. |
| Metrics | Session outcome variable (`resolved` / `handed_off` / `failed`) set by the agent for later analytics. |
