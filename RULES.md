# BỘ QUY CHUẨN QUẢN TRỊ KỸ THUẬT: RULES.MD

> **Tiêu chuẩn:** Technical Planning and Execution Governance (TPEG-v2)  
> **Phạm vi hiệu lực:** Toàn cục (Bắt buộc cho mọi dự án, bài toán kỹ thuật và xử lý sự cố trong Antigravity & Gemini)  
> **Cấp độ thực thi:** Cưỡng chế tự động và toàn diện (Zero-Tolerance Policy)  
> **Nguyên tắc chỉ đạo tối cao:** Hoạch định trước khi Thực thi (Plan-Before-Execute)

---

## 1. CÁC TIÊN ĐỀ BẤT BIẾN (FUNDAMENTAL AXIOMS)

### 1.1. KHÔNG KẾ HOẠCH, KHÔNG HÀNH ĐỘNG (PLAN-BEFORE-EXECUTE)
Mọi can thiệp vào mã nguồn, cấu hình hệ thống hoặc quy trình vận hành đều bắt buộc phải bắt đầu bằng một Kế hoạch Thực thi (Execution Plan) được phê chuẩn. Tuyệt đối cấm hành động dựa trên cảm tính hoặc phương pháp thử-sai.

### 1.2. NGUYÊN TẮC BẰNG CHỨNG (EVIDENCE-BASED GROUNDING)
Mọi đề xuất trong kế hoạch phải được chứng minh bằng hiện trạng thực tế (mã nguồn hiện hữu, cấu hình tệp cụ thể, nhật ký lỗi hệ thống, hoặc số liệu quan sát). Nghiêm cấm hoàn toàn hành vi bịa đặt thông tin, phỏng đoán hạ tầng hoặc tạo thực thể ảo.

### 1.3. KỶ LUẬT PHẠM VI (SCOPE DISCIPLINE)
Kế hoạch chỉ tập trung giải quyết mục tiêu cốt lõi đã cam kết. Nghiêm cấm tối ưu hóa sớm, tái cấu trúc ngoài phạm vi hoặc bổ sung tính năng tiện ích không được yêu cầu.

### 1.4. DỪNG KHI GẶP ẨN SỐ (HALT-ON-UNKNOWN PROTOCOL)
Khi phát hiện thiếu hụt thông số kỹ thuật, biến môi trường hoặc logic nghiệp vụ, LẬP TỨC DỪNG tiến trình lập kế hoạch và phát hành yêu cầu làm rõ định lượng. Tuyệt đối không được phép tự suy diễn để tiếp tục vẽ kế hoạch giả tạo.

### 1.5. TUYỆT ĐỐI GIAO PHÓ KẾ HOẠCH CHO GEMINI (ZERO SELF-PLANNING BY ANTIGRAVITY)
Antigravity giữ vai trò khung thực thi (Harness), Google Gemini giữ vai trò bộ não lập luận và hoạch định (Brain). Khi có yêu cầu lập kế hoạch (qua `/antigravity-with-gemini` hoặc câu lệnh lập plan), Antigravity **BẮT BUỘC PHẢI GỌI TOOL `gemini_plan`** (hoặc lệnh `g2a plan`), **TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ SUY NGHĨ HOẶC TỰ VIẾT PLAN** trong ngữ cảnh của mình. Kế hoạch phải được lưu xuống đĩa tại `.g2a/plans/` và chỉ chuyển giao con trỏ siêu nhẹ (< 50 tokens) về cho Antigravity để triệt tiêu context bloat.

---

## 2. NGUYÊN TẮC THIẾT LẬP KẾ HOẠCH THỰC TẾ

### 2.1. CƠ CHẾ PHÂN RÃ WBS VÀ TÍNH TOÀN VẸN 100%
- Kế hoạch phải bao hàm chính xác 100% phạm vi công việc đã xác định, không thừa và không thiếu.
- Các gói công việc phải loại trừ tương hỗ lẫn nhau (Mutually Exclusive); tuyệt đối không cho phép trùng lặp đầu việc giữa các gói.
- Tên gói công việc phải được danh từ hóa theo sản phẩm chuyển giao (ví dụ: *"Module Xác thực Khách hàng Hoàn tất"*), không sử dụng động từ trừu tượng chung chung.

### 2.2. QUY TẮC GIỚI HẠN THỜI LƯỢNG (8/80 RULE)
- Gói công việc ở tầng phân rã thấp nhất phải có khối lượng thực thi từ 8 giờ đến 80 giờ làm việc tiêu chuẩn (hoặc 0.5h đến 80h đối với các vi tác vụ atomic của AI agent).
- Công việc vượt quá 80 giờ bắt buộc phải phân rã tiếp; công việc quá nhỏ phải được gom nhóm hợp lý vào gói kết quả liền kề.

### 2.3. ƯỚC LƯỢNG THỐNG KÊ PERT
Thời gian của các gói công việc phức tạp phải được lượng hóa theo công thức PERT:
$$E = \frac{O + 4M + P}{6}$$
Độ lệch chuẩn thể hiện mức độ bất định:
$$\sigma = \frac{P - O}{6}$$
Nếu $\sigma > 0.2E$, gói công việc đối mặt với rủi ro kỹ thuật lớn, bắt buộc phải tiến hành Spike/Nghiên cứu thăm dò trước khi đưa vào đường găng.

### 2.4. LIÊN KẾT ĐƯỜNG GĂNG (CRITICAL PATH)
Kế hoạch phải chỉ định rõ các phụ thuộc kỹ thuật theo chuẩn (FS, SS, FF, SF) và làm nổi bật chuỗi nhiệm vụ cấu thành đường găng tiến độ.

---

## 3. RÀNG BUỘC PHẠM VI VÀ KIỂM SOÁT BỊA ĐẶT

### 3.1. PHÂN LẬP RANH GIỚI BẮT BUỘC (IN-SCOPE & NON-GOALS)
- Phải phân định rõ ràng hai danh mục: Trong phạm vi (In-Scope) và Ngoài phạm vi (Non-Goals).
- Mục **Non-Goals bắt buộc phải chỉ định tối thiểu 3 khía cạnh kỹ thuật** liên quan trực tiếp nhưng kiên quyết từ chối thực hiện trong chu kỳ hiện tại để triệt tiêu scope creep.

### 3.2. ĐỐI CHIẾU MÔI TRƯỜNG THỰC TẾ (AS-IS GROUNDING)
- Mọi thao tác phải chỉ định chính xác đường dẫn tệp (file paths), tên bảng cơ sở dữ liệu, tham số hàm hoặc địa chỉ endpoint cụ thể.
- Nghiêm cấm dùng các tên tượng trưng vô nghĩa như `path/to/file`, `example_service`, `temp_db`.

### 3.3. SỔ NHẬT KÝ RAID BẮT BUỘC (PRE-MORTEM ANALYSIS)
Mọi kế hoạch phải đính kèm bảng nhật ký RAID (Risks, Assumptions, Issues, Dependencies) đã qua phân tích thất bại giả định (Strategic Pre-Mortem) để nhận diện các điểm gãy chí mạng trước khi tốn kém tài nguyên.

---

## 4. TRÁCH NHIỆM GIẢI TRÌNH VÀ TIÊU CHÍ NGHIỆM THU

### 4.1. CƠ CHẾ SỞ HỮU ĐƠN NHẤT (DRI MODEL)
- Mỗi gói công việc chỉ có **DUY NHẤT một Cá nhân Chịu trách nhiệm Trực tiếp (DRI)**.
- Nghiêm cấm bàn giao cho tập thể vô danh hoặc gán nhiều chủ sở hữu cho một đầu việc. AI tác tử đóng vai trò thực thi phụ trợ, DRI con người nắm giữ quyền phán quyết cuối cùng.

### 4.2. TIÊU CHÍ NGHIỆM THU NHỊ PHÂN (BINARY PASS/FAIL CRITERIA)
- Tiêu chí hoàn thành của từng nhiệm vụ phải được viết dưới dạng các phát biểu có thể kiểm chứng độc lập, chỉ nhận kết quả **ĐẠT (PASS)** hoặc **KHÔNG ĐẠT (FAIL)**.
- Nghiêm cấm sử dụng các tính từ định tính cảm tính như "hoạt động ổn định", "tối ưu", "giao diện trực quan".

### 4.3. ĐỊNH NGHĨA HOÀN THÀNH TOÀN CỤC (DEFINITION OF DONE - DOD)
Một gói việc chỉ được đóng lại khi thỏa mãn toàn bộ các điều kiện:
1. Kiểm thử tự động (Unit/Integration Tests) hoàn tất với độ bao phủ đạt chuẩn quy định (100% pass).
2. Vượt qua 100% các cổng kiểm tra cú pháp và định dạng (Linter/Compiler), không có cảnh báo nào bị bỏ qua.
3. Tài liệu kiến trúc và hướng dẫn vận hành liên quan được cập nhật đồng bộ.
4. Được nghiệm thu và ký duyệt chính thức bởi DRI phụ trách.

---

## 5. BIỂU MẪU KẾ HOẠCH TIÊU CHUẨN (MANDATORY PLAN TEMPLATE)

```markdown
# [MÃ_KẾ_HOẠCH] - TÊN KẾ HOẠCH TRIỂN KHAI KỸ THUẬT
- **DRI Sở hữu:** @Ten_Dinh_Danh (Chính xác 01 cá nhân chịu trách nhiệm)
- **Trạng thái:** DRAFT | UNDER_REVIEW | APPROVED | BLOCKED
- **Ngày khởi tạo:** YYYY-MM-DD | **Hạn cam kết hoàn tất:** YYYY-MM-DD

### I. CĂN CỨ KỸ THUẬT & HIỆN TRẠNG (GROUNDED CONTEXT)
- **Trạng thái hiện hữu (AS-IS):** [Đường dẫn tệp, hàm mã nguồn, nhật ký lỗi, hoặc chỉ số hệ thống]
- **Vấn đề kỹ thuật cốt lõi:** [Mô tả cụ thể và lượng hóa tổn thất kỹ thuật/nghiệp vụ nếu không xử lý]
- **Tài liệu tham chiếu:** [Đặc tả kiến trúc, RFC, PRD, Báo cáo sự cố]

### II. ĐẶC TẢ PHẠM VI (SCOPE BOUNDARIES)
- **Trong phạm vi (In-Scope / Deliverables):**
  - [Sản phẩm chuyển giao 1: Kết quả định lượng cụ thể]
  - [Sản phẩm chuyển giao 2: Kết quả định lượng cụ thể]
- **Ngoài phạm vi (Non-Goals / Out-of-Scope - Tối thiểu 3 mục):**
  - [Hạng mục loại trừ 1: Khía cạnh kỹ thuật liên quan nhưng kiên quyết không làm và lý do]
  - [Hạng mục loại trừ 2: Tính năng tiện ích hoặc tái cấu trúc bị trì hoãn sang giai đoạn sau]
  - [Hạng mục loại trừ 3: Giới hạn hạ tầng không can thiệp]

### III. NHẬT KÝ RAID & DỰ PHÒNG RỦI RO (PRE-MORTEM OUTPUT)
| Phân loại | Mã | Chi tiết Nội dung | Tác động (H/M/L) | Phương án Can thiệp Chủ động | DRI Xử lý |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Risk | R-01 | [Nguy cơ sụp đổ phát hiện từ Pre-Mortem] | Cao | [Giải pháp kỹ thuật phòng ngừa từ đầu] | @Ten_DRI |
| Assumption | A-01 | [Giả định kỹ thuật đang lấy làm nền tảng] | Trung bình | [Kế hoạch kiểm chứng bằng thực nghiệm] | @Ten_DRI |
| Dependency | D-01 | [Thư viện bên thứ ba hoặc giao diện ngoài] | Cao | [Phương án dự phòng khi giao diện lỗi] | @Ten_DRI |

### IV. PHÂN RÃ CÔNG VIỆC WBS VÀ TIẾN ĐỘ PERT
| Mã WBS | Gói Công Việc (Danh từ hóa sản phẩm) | Phụ thuộc | O (h) | M (h) | P (h) | PERT E (h) | Sigma (h) | DRI Phụ trách |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1.1 | [Tên gói công việc con 1] | N/A | [O] | [M] | [P] | [Tính E] | [Tính Sigma] | @Ten_DRI |
| 1.2 | [Tên gói công việc con 2] | 1.1 FS | [O] | [M] | [P] | [Tính E] | [Tính Sigma] | @Ten_DRI |

### V. TIÊU CHÍ NGHIỆM THU VÀ CỔNG CHẤT LƯỢNG (AC & DOD)
- **Tiêu chí Nghiệm thu Nhị phân (Binary Pass/Fail):**
  - [ ] Điều kiện 1: [Mô tả điều kiện nghiệm thu định lượng, có thể xác minh độc lập bằng Pass/Fail]
  - [ ] Điều kiện 2: [Mô tả điều kiện nghiệm thu định lượng, có thể xác minh độc lập bằng Pass/Fail]
- **Cổng nghiệm thu kỹ thuật (Definition of Done - DoD):**
  - [ ] Kiểm thử tự động vượt qua 100%, tỷ lệ bao phủ mã nguồn >= [X]%
  - [ ] Quá trình xây dựng bản phát hành (Build/Package) thành công không phát sinh cảnh báo
  - [ ] Toàn bộ tài liệu vận hành và sơ đồ liên quan được hợp nhất vào kho lưu trữ chính
```
