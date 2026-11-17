// เมนูตัวอย่าง — แก้ราคา/ชื่อได้ที่หน้า /admin.html > จัดการเมนู
const toppings = {
  id: 'topping', name: 'ท็อปปิ้ง (เลือกได้หลายอย่าง)', type: 'multi', required: false, max: 4,
  options: [
    { id: 'choc', name: 'ช็อกโกแลต', price: 5 },
    { id: 'banana', name: 'กล้วยหอม', price: 10 },
    { id: 'strawberry', name: 'สตรอว์เบอร์รี่', price: 15 },
    { id: 'cheese', name: 'ชีส', price: 10 },
    { id: 'cream', name: 'วิปครีม', price: 10 },
    { id: 'ice', name: 'ไอศกรีม', price: 15 },
  ],
};
const size = {
  id: 'size', name: 'ขนาด', type: 'single', required: true,
  options: [{ id: 'S', name: 'S', price: 0 }, { id: 'M', name: 'M', price: 10 }, { id: 'L', name: 'L', price: 20 }],
};
const sweet = {
  id: 'sweet', name: 'ความหวาน', type: 'single', required: true,
  options: ['0%', '25%', '50%', '75%', '100%', '120%'].map(n => ({ id: n, name: n, price: 0 })),
};
const ice = {
  id: 'ice', name: 'น้ำแข็ง', type: 'single', required: true,
  options: [{ id: 'normal', name: 'ปกติ', price: 0 }, { id: 'less', name: 'น้อย', price: 0 }, { id: 'none', name: 'ไม่ใส่', price: 0 }],
};
const form = {
  id: 'form', name: 'รูปแบบ', type: 'single', required: true,
  options: [{ id: 'cold', name: 'เย็น', price: 0 }, { id: 'blend', name: 'ปั่น', price: 5 }, { id: 'hot', name: 'ร้อน', price: 0 }],
};

module.exports = {
  categories: [{ id: 'crepe', name: 'เครป' }, { id: 'drink', name: 'เครื่องดื่ม' }],
  items: [
    { id: 'c1', category: 'crepe', name: 'เครปช็อกโกแลตกล้วย', price: 45, available: true, stock: null, image: '', recommended: true, description: 'แป้งเครปบางกรอบ ไส้ช็อกโกแลตและกล้วยหอม', groups: [toppings] },
    { id: 'c2', category: 'crepe', name: 'เครปไข่แฮมชีส', price: 55, available: true, groups: [toppings] },
    { id: 'c3', category: 'crepe', name: 'เครปสตรอว์เบอร์รี่ครีม', price: 55, available: true, groups: [toppings] },
    { id: 'c4', category: 'crepe', name: 'เครปไส้กรอกชีส', price: 50, available: true, groups: [toppings] },
    { id: 'd1', category: 'drink', name: 'ชาไทย', price: 35, available: true, stock: null, image: '', recommended: true, description: 'ชาไทยเข้มข้น หอมมัน', groups: [size, form, sweet, ice] },
    { id: 'd2', category: 'drink', name: 'ชาเขียวนม', price: 40, available: true, groups: [size, form, sweet, ice] },
    { id: 'd3', category: 'drink', name: 'โกโก้', price: 40, available: true, groups: [size, form, sweet, ice] },
    { id: 'd4', category: 'drink', name: 'น้ำส้มคั้น', price: 35, available: true, groups: [size, ice] },
  ],
};
